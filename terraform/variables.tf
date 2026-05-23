variable "project_id" {
  type        = string
  description = "The exact Project ID from your GCP Console"
}

variable "billing_account_id" {
  type        = string
  description = "Your GCP Billing Account ID (Found under Billing -> Overview)"
}

variable "region" {
  type    = string
  default = "us-central1" # Explicitly locked to Free Tier zone
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "ssh_public_key_path" {
  type        = string
  default     = "./id_rsa.pub"
  description = "Path to your local SSH public key file"
}

variable "ssh_user" {
  type    = string
  default = "tansikai"
}
