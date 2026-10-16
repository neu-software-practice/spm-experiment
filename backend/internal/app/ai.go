package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

var (
	ErrAIDisabled        = errors.New("AI assistant is not configured")
	ErrAIUpstream        = errors.New("AI service failed")
	ErrAIInvalidResponse = errors.New("invalid AI response")
	ErrAITimeout         = errors.New("AI call timed out")

	errRetryable = errors.New("retryable")
	errAIStalled = errors.New("AI stream stalled")
)

const (
	defaultAITimeout = 3 * time.Minute
	maxAITimeout     = 5 * time.Minute
	// A stream silent for this long is treated as dropped and retried.
	defaultAIIdleTimeout = 45 * time.Second
	maxAIRetries         = 2
	// A streamed reply, reasoning included, larger than this is cut off.
	maxAIStream = 4 << 20
)

type AIConfig struct {
	BaseURL string
	APIKey  string
	Model   string
	// Timeout bounds each model call; an agent turn may make several.
	Timeout time.Duration
}

func AIConfigFromEnv() (AIConfig, error) {
	config := AIConfig{
		BaseURL: os.Getenv("AI_BASE_URL"),
		APIKey:  os.Getenv("AI_API_KEY"),
		Model:   os.Getenv("AI_MODEL"),
		Timeout: defaultAITimeout,
	}
	if value := strings.TrimSpace(os.Getenv("AI_TIMEOUT")); value != "" {
		timeout, err := time.ParseDuration(value)
		if err != nil || timeout <= 0 || timeout > maxAITimeout {
			return AIConfig{}, errors.New("AI_TIMEOUT must be a positive duration no greater than 5m")
		}
		config.Timeout = timeout
	}
	return config, nil
}

// ChatMessage is one OpenAI Chat Completions message.
type ChatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ToolSpec struct {
	Name        string
	Description string
	Parameters  map[string]any
}

// StreamDelta is one streamed fragment. Exactly one field is set; ToolName
// announces a tool call as soon as its name arrives, before its arguments.
// Retry says the call is starting over and everything streamed since it began
// should be discarded.
type StreamDelta struct {
	Content   string
	Reasoning string
	ToolName  string
	ToolIndex int
	Retry     int
}

// AssistantReply is the complete message assembled from one streamed call.
type AssistantReply struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
}

type ChatModel interface {
	StreamChat(ctx context.Context, messages []ChatMessage, tools []ToolSpec, onDelta func(StreamDelta)) (AssistantReply, error)
}

type openAIChatModel struct {
	endpoint    string
	apiKey      string
	model       string
	timeout     time.Duration
	idleTimeout time.Duration
	retryDelay  time.Duration
	client      *http.Client
}

// NewChatModel returns nil when AI is disabled. Every other endpoint keeps
// working without model credentials.
func NewChatModel(config AIConfig) (ChatModel, error) {
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.Model = strings.TrimSpace(config.Model)
	if config.APIKey == "" && config.Model == "" {
		return nil, nil
	}
	if config.APIKey == "" || config.Model == "" {
		return nil, errors.New("AI_API_KEY and AI_MODEL must both be configured")
	}
	base := strings.TrimSpace(config.BaseURL)
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	parsed, err := url.Parse(base)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" ||
		parsed.User != nil || strings.ContainsAny(base, "?#") {
		return nil, errors.New("AI_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment")
	}
	if config.Timeout == 0 {
		config.Timeout = defaultAITimeout
	}
	if config.Timeout < 0 || config.Timeout > maxAITimeout {
		return nil, errors.New("AI timeout must be positive and no greater than 5m")
	}
	return &openAIChatModel{
		endpoint:    strings.TrimRight(base, "/") + "/chat/completions",
		apiKey:      config.APIKey,
		model:       config.Model,
		timeout:     config.Timeout,
		idleTimeout: defaultAIIdleTimeout,
		retryDelay:  time.Second,
		client: &http.Client{
			// Never forward the conversation or credential to a redirect destination.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

type toolDefinition struct {
	Type     string `json:"type"`
	Function struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Parameters  map[string]any `json:"parameters"`
	} `json:"function"`
}

func (m *openAIChatModel) StreamChat(ctx context.Context, messages []ChatMessage, tools []ToolSpec, onDelta func(StreamDelta)) (AssistantReply, error) {
	definitions := make([]toolDefinition, len(tools))
	for i, tool := range tools {
		definitions[i].Type = "function"
		definitions[i].Function.Name = tool.Name
		definitions[i].Function.Description = tool.Description
		definitions[i].Function.Parameters = tool.Parameters
	}
	body, err := json.Marshal(struct {
		Model    string           `json:"model"`
		Messages []ChatMessage    `json:"messages"`
		Tools    []toolDefinition `json:"tools,omitempty"`
		Stream   bool             `json:"stream"`
	}{Model: m.model, Messages: messages, Tools: definitions, Stream: true})
	if err != nil {
		return AssistantReply{}, err
	}
	for attempt := 0; ; attempt++ {
		reply, err := m.streamOnce(ctx, body, onDelta)
		if err == nil || !errors.Is(err, errRetryable) || attempt == maxAIRetries {
			return reply, err
		}
		// Whatever this attempt streamed is void; the caller discards it on Retry.
		onDelta(StreamDelta{Retry: attempt + 1})
		select {
		case <-time.After(time.Duration(attempt+1) * m.retryDelay):
		case <-ctx.Done():
			return AssistantReply{}, aiRequestError(ctx, ctx.Err())
		}
	}
}

// streamOnce makes one model call. Connection drops, stalls and overload
// responses are marked retryable; a reply that finished is not retried.
func (m *openAIChatModel) streamOnce(parent context.Context, body []byte, onDelta func(StreamDelta)) (AssistantReply, error) {
	timed, cancelTimeout := context.WithTimeout(parent, m.timeout)
	defer cancelTimeout()
	ctx, cancel := context.WithCancelCause(timed)
	defer cancel(nil)
	idle := time.AfterFunc(m.idleTimeout, func() { cancel(errAIStalled) })
	defer idle.Stop()
	failed := func(err error) error {
		switch {
		case parent.Err() != nil:
			return aiRequestError(parent, parent.Err())
		case errors.Is(context.Cause(ctx), errAIStalled):
			return fmt.Errorf("%w: %w: no data for %s", ErrAIUpstream, errRetryable, m.idleTimeout)
		case timed.Err() != nil:
			return ErrAITimeout
		}
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return AssistantReply{}, ErrAIUpstream
	}
	request.Header.Set("Authorization", "Bearer "+m.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	response, err := m.client.Do(request)
	if err != nil {
		return AssistantReply{}, failed(fmt.Errorf("%w: %w: %v", ErrAIUpstream, errRetryable, err))
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500 {
			return AssistantReply{}, fmt.Errorf("%w: %w: HTTP %d", ErrAIUpstream, errRetryable, response.StatusCode)
		}
		return AssistantReply{}, fmt.Errorf("%w: HTTP %d", ErrAIUpstream, response.StatusCode)
	}
	stream := &idleReader{reader: response.Body, onRead: func() { idle.Reset(m.idleTimeout) }}
	reply, err := readChatStream(io.LimitReader(stream, maxAIStream), onDelta)
	if err != nil {
		return AssistantReply{}, failed(err)
	}
	return reply, nil
}

// idleReader reports every read that returned data, to keep a stall timer alive.
type idleReader struct {
	reader io.Reader
	onRead func()
}

func (r *idleReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.onRead()
	}
	return n, err
}

type chatChunk struct {
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"`
			ToolCalls        []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// readChatStream assembles an OpenAI-style SSE stream into one reply.
func readChatStream(body io.Reader, onDelta func(StreamDelta)) (AssistantReply, error) {
	var reply AssistantReply
	var content strings.Builder
	calls := map[int]*ToolCall{}
	var order []int
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64<<10), maxAIStream)
	done := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			done = true
			break
		}
		var chunk chatChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return AssistantReply{}, ErrAIInvalidResponse
		}
		for _, choice := range chunk.Choices {
			delta := choice.Delta
			// Some providers send the same text as both fields.
			reasoning := delta.ReasoningContent
			if reasoning == "" {
				reasoning = delta.Reasoning
			}
			if reasoning != "" {
				onDelta(StreamDelta{Reasoning: reasoning})
			}
			if delta.Content != "" {
				content.WriteString(delta.Content)
				onDelta(StreamDelta{Content: delta.Content})
			}
			for _, fragment := range delta.ToolCalls {
				call, ok := calls[fragment.Index]
				if !ok {
					call = &ToolCall{Type: "function"}
					calls[fragment.Index] = call
					order = append(order, fragment.Index)
				}
				// Continuation chunks repeat the call with empty id and name.
				if fragment.ID != "" {
					call.ID = fragment.ID
				}
				if fragment.Function.Name != "" && call.Function.Name == "" {
					call.Function.Name = fragment.Function.Name
					onDelta(StreamDelta{ToolName: fragment.Function.Name, ToolIndex: fragment.Index})
				}
				call.Function.Arguments += fragment.Function.Arguments
			}
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				reply.FinishReason = *choice.FinishReason
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return AssistantReply{}, fmt.Errorf("%w: reading stream: %v", ErrAIUpstream, err)
	}
	if !done && reply.FinishReason == "" {
		return AssistantReply{}, fmt.Errorf("%w: stream ended before finishing", ErrAIUpstream)
	}
	reply.Content = content.String()
	for _, index := range order {
		call := calls[index]
		if call.Function.Name == "" {
			return AssistantReply{}, ErrAIInvalidResponse
		}
		if call.ID == "" {
			call.ID = fmt.Sprintf("call_%d_%s", index, newID())
		}
		reply.ToolCalls = append(reply.ToolCalls, *call)
	}
	return reply, nil
}

func aiRequestError(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrAITimeout
	}
	return fmt.Errorf("%w: %v", ErrAIUpstream, err)
}
