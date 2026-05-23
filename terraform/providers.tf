terraform {
  required_version = ">= 1.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  #   backend "gcs" {
  #     bucket      = "airborne-tf-state-bucket"
  #     prefix      = "terraform/state"
  #     credentials = "gcp-credentials.json"
  #   }
}

provider "google" {
  credentials = file("gcp-credentials.json")
  project     = var.project_id
  region      = var.region
  zone        = var.zone
}
