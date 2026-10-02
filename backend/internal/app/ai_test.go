package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testAIGenerator(t *testing.T, baseURL string, timeout time.Duration) ChildGenerator {
	t.Helper()
	generator, err := NewAIChildGenerator(AIConfig{
		BaseURL: baseURL,
		APIKey:  "test-only-key",
		Model:   "test-model",
		Timeout: timeout,
	})
	if err != nil {
		t.Fatal(err)
	}
	return generator
}

func completionJSON(content, finishReason string) string {
	raw, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{
			"finish_reason": finishReason,
			"message":       map[string]string{"role": "assistant", "content": content},
		}},
	})
	return string(raw)
}

func TestAIHTTPIntegrationIncludesContextAndExtraPrompt(t *testing.T) {
	f := newGenerationFixture(t)
	type capturedRequest struct {
		input        GenerationInput
		model        string
		systemPrompt string
	}
	observed := make(chan capturedRequest, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected provider request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-only-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("missing authentication or JSON content type")
		}
		var request struct {
			Model          string            `json:"model"`
			Messages       []chatMessage     `json:"messages"`
			ResponseFormat map[string]string `json:"response_format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(request.Messages) != 2 || request.Messages[0].Role != "system" || request.Messages[1].Role != "user" {
			t.Error("expected separate instructions and user context")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if request.ResponseFormat["type"] != "json_object" {
			t.Error("JSON mode was not requested")
		}
		var received GenerationInput
		if err := json.Unmarshal([]byte(request.Messages[1].Content), &received); err != nil {
			t.Error(err)
		}
		if strings.Contains(request.Messages[1].Content, f.project.ID) || strings.Contains(request.Messages[1].Content, f.story.ID) {
			t.Error("provider payload unnecessarily includes internal IDs")
		}
		observed <- capturedRequest{input: received, model: request.Model, systemPrompt: request.Messages[0].Content}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, completionJSON(`{"children":[{"name":"裁剪封面图片"},{"name":"预览封面效果"}]}`, "stop"))
	}))
	defer upstream.Close()
	router := NewRouter(f.store, testAIGenerator(t, upstream.URL+"/v1/", time.Second))
	response := performGeneration(router, f.path(f.story), `{"count":2,"prompt":"  重点考虑移动端，避免重复已有步骤  "}`)
	assertStatus(t, response, http.StatusCreated)
	want := GenerationInput{
		ProjectName: "内容平台",
		Parent:      GenerationNode{Name: "添加封面", Kind: KindStory},
		Ancestors: []GenerationNode{
			{Name: "内容创作者", Kind: KindRole},
			{Name: "发布文章", Kind: KindEpic},
		},
		ChildKind:        KindSubstory,
		ExistingChildren: []string{"选择封面图片"},
		Count:            2,
		Prompt:           "重点考虑移动端，避免重复已有步骤",
	}
	captured := <-observed
	if !reflect.DeepEqual(captured.input, want) || captured.model != "test-model" || !strings.Contains(captured.systemPrompt, "JSON") {
		t.Fatalf("wrong provider payload: %#v, model %q", captured.input, captured.model)
	}
	project := loadTestProject(t, f)
	if len(project.Nodes) != 6 || project.Nodes[4].Name != "裁剪封面图片" || project.Nodes[5].Name != "预览封面效果" {
		t.Fatalf("generated nodes were not saved: %#v", project.Nodes)
	}
	status := httptest.NewRecorder()
	router.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/ai/status", nil))
	assertStatus(t, status, http.StatusOK)
	if status.Body.String() != `{"enabled":true}` {
		t.Fatalf("unexpected public AI status: %s", status.Body)
	}
}

func TestAIProviderFailuresDoNotWriteOrLeakDetails(t *testing.T) {
	validContent := `{"children":[{"name":"步骤一"},{"name":"步骤二"}]}`
	for _, tc := range []struct {
		name       string
		status     int
		body       string
		wantStatus int
	}{
		{"authentication failure", http.StatusUnauthorized, `{"error":"test-only-key invalid"}`, http.StatusBadGateway},
		{"rate limited", http.StatusTooManyRequests, `{"error":"quota details"}`, http.StatusBadGateway},
		{"service unavailable", http.StatusServiceUnavailable, `{"error":"private provider failure"}`, http.StatusBadGateway},
		{"invalid outer JSON", http.StatusOK, "not JSON", http.StatusBadGateway},
		{"missing choices", http.StatusOK, `{}`, http.StatusBadGateway},
		{"truncated output", http.StatusOK, completionJSON(validContent, "length"), http.StatusBadGateway},
		{"filtered output", http.StatusOK, completionJSON(validContent, "content_filter"), http.StatusBadGateway},
		{"refusal", http.StatusOK, `{"choices":[{"finish_reason":"stop","message":{"content":null,"refusal":"No"}}]}`, http.StatusBadGateway},
		{"invalid JSON content", http.StatusOK, completionJSON("invalid", "stop"), http.StatusBadGateway},
		{"missing names", http.StatusOK, completionJSON(`{"children":[{},{}]}`, "stop"), http.StatusBadGateway},
		{"extra model fields", http.StatusOK, completionJSON(`{"children":[{"name":"步骤一","parentId":"other"},{"name":"步骤二"}]}`, "stop"), http.StatusBadGateway},
		{"wrong children type", http.StatusOK, completionJSON(`{"children":"bad"}`, "stop"), http.StatusBadGateway},
		{"multiple content objects", http.StatusOK, completionJSON(validContent+" {}", "stop"), http.StatusBadGateway},
		{"oversized response", http.StatusOK, strings.Repeat("x", maxAIResponse+1), http.StatusBadGateway},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGenerationFixture(t)
			before := loadTestProject(t, f)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer upstream.Close()
			router := NewRouter(f.store, testAIGenerator(t, upstream.URL, time.Second))
			response := performGeneration(router, f.path(f.story), `{"count":2}`)
			assertStatus(t, response, tc.wantStatus)
			if strings.Contains(response.Body.String(), "test-only-key") || strings.Contains(response.Body.String(), tc.body) {
				t.Fatal("provider details were exposed to caller")
			}
			if !reflect.DeepEqual(before, loadTestProject(t, f)) {
				t.Fatal("provider error changed project data")
			}
		})
	}
}

func TestAITimeoutReturnsGatewayTimeoutWithoutWrites(t *testing.T) {
	f := newGenerationFixture(t)
	before := loadTestProject(t, f)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(300 * time.Millisecond):
			fmt.Fprint(w, completionJSON(`{"children":[{"name":"迟到的内容"}]}`, "stop"))
		}
	}))
	defer upstream.Close()
	router := NewRouter(f.store, testAIGenerator(t, upstream.URL, 20*time.Millisecond))
	assertStatus(t, performGeneration(router, f.path(f.story), `{"count":1}`), http.StatusGatewayTimeout)
	if !reflect.DeepEqual(before, loadTestProject(t, f)) {
		t.Fatal("timed-out generation changed project data")
	}
}

func TestAIClientDoesNotFollowRedirects(t *testing.T) {
	var forwarded atomic.Bool
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Store(true) }))
	defer destination.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	_, err := testAIGenerator(t, upstream.URL, time.Second).GenerateChildren(context.Background(), GenerationInput{})
	if !errors.Is(err, ErrAIUpstream) || forwarded.Load() {
		t.Fatalf("provider request followed a redirect or succeeded: %v", err)
	}
}

func TestAIClientHonorsCancellationAndContextLimit(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer upstream.Close()
	generator := testAIGenerator(t, upstream.URL, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := generator.GenerateChildren(ctx, GenerationInput{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want cancellation", err)
	}
	if _, err := generator.GenerateChildren(context.Background(), GenerationInput{ProjectName: strings.Repeat("x", maxAIContext+1)}); !errors.Is(err, ErrAIContextTooLarge) {
		t.Fatalf("got %v, want context limit", err)
	}
	if calls.Load() != 0 {
		t.Fatal("canceled or oversized request was sent to provider")
	}
}

func TestAIConfiguration(t *testing.T) {
	if generator, err := NewAIChildGenerator(AIConfig{}); err != nil || generator != nil {
		t.Fatalf("empty configuration should disable generation: %v", err)
	}
	for _, config := range []AIConfig{
		{Model: "test-model"},
		{APIKey: "test-only-key"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "file:///tmp/model"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https://user:password@example.com/v1"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https://example.com/v1?token=secret"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https://example.com/v1?"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https://example.com/v1#fragment"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https://example.com/v1#"},
		{APIKey: "test-only-key", Model: "test-model", BaseURL: "https:///v1"},
		{APIKey: "test-only-key", Model: "test-model", Timeout: -time.Second},
		{APIKey: "test-only-key", Model: "test-model", Timeout: 3 * time.Minute},
	} {
		if _, err := NewAIChildGenerator(config); err == nil {
			t.Error("invalid AI configuration was accepted")
		}
	}
	for _, key := range []string{"AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_TIMEOUT"} {
		t.Setenv(key, "")
	}
	t.Setenv("AI_API_KEY", "test-only-key")
	t.Setenv("AI_MODEL", "configured-model")
	t.Setenv("AI_BASE_URL", "https://example.com/v1")
	t.Setenv("AI_TIMEOUT", "45s")
	config, err := AIConfigFromEnv()
	if err != nil || config.Timeout != 45*time.Second || config.Model != "configured-model" || config.BaseURL != "https://example.com/v1" || config.APIKey != "test-only-key" {
		t.Fatal("environment configuration was not loaded correctly")
	}
	for _, value := range []string{"bad", "0s", "-1s", "121s"} {
		t.Setenv("AI_TIMEOUT", value)
		if _, err := AIConfigFromEnv(); err == nil {
			t.Errorf("invalid AI_TIMEOUT %q accepted", value)
		}
	}
}
