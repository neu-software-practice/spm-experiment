package main

import (
	"log"
	"os"

	"spm-experiment/internal/app"
)

func main() {
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

	if err := app.NewRouter(store).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
