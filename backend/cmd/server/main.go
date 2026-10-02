package main

import (
	"log"
	"os"

	"spm-experiment/internal/app"
)

func main() {
	aiConfig, err := app.AIConfigFromEnv()
	if err != nil {
		log.Fatalf("load AI configuration: %v", err)
	}
	generator, err := app.NewAIChildGenerator(aiConfig)
	if err != nil {
		log.Fatalf("configure AI generation: %v", err)
	}
	if generator == nil {
		log.Print("AI generation disabled: configure AI_API_KEY and AI_MODEL to enable")
	}

	dataFile := os.Getenv("DATA_FILE")
	if dataFile == "" {
		dataFile = "data/spm.json"
	}

	store, err := app.OpenStore(dataFile)
	if err != nil {
		log.Fatalf("open data store: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := app.NewRouter(store, generator).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
