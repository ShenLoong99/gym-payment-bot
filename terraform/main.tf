# Dynamic Lookups: Fetches runtime account numbers safely to pass arguments accurately
data "google_project" "current_project" {
  project_id = var.project_id
}

# ==========================================
# 1. INFRASTRUCTURE API ENABLERS
# ==========================================

# Enable Compute Engine API
resource "google_project_service" "compute_api" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

# Enable Cloud Billing Budget API
resource "google_project_service" "billing_budgets_api" {
  project            = var.project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

# ==========================================
# 2. NETWORKING & SECURITY FIREWALLS
# ==========================================

# Allow inbound SSH (22), HTTP (80), and HTTPS (443) traffic to the VM instance from any source IP
resource "google_compute_firewall" "allow_web" {
  depends_on = [google_project_service.compute_api]

  name    = "allow-web-and-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22", "80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["free-tier-vm"]
}

# ==========================================
# 3. COMPUTATION NODES (STRICT FREE TIER)
# ==========================================

# Provision a single e2-micro instance with startup script to set up Node.js environment for the chatbot application
resource "google_compute_instance" "free_vm" {
  name         = "airbourne-app-server"
  machine_type = "e2-micro"
  zone         = var.zone

  tags = ["free-tier-vm", "http-server", "https-server"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 30
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {
      # Empty block allocates a public ephemeral IP address to the instance
    }
  }

  metadata = {
    ssh-keys = "${var.ssh_user}:${file(var.ssh_public_key_path)}"
  }

  metadata_startup_script = templatefile("${path.module}/scripts/deploy.sh", {
    SSH_USER                = var.ssh_user
    GITHUB_USERNAME         = var.github_username
    REPO_NAME               = var.repo_name
    GIT_BRANCH              = var.git_branch
    GITHUB_TOKEN            = var.github_token
    ENV_FILE_CONTENT        = file("${path.module}/../.env")
    GOOGLE_CREDENTIALS_JSON = file("${path.module}/../google-credentials.json")
  })
}

# ==========================================
# 4. FINANCIAL GUARDRAILS & BUDGET ALERTS
# ==========================================

# Absolute budget cap to prevent any accidental charges beyond Free Tier limits
resource "google_billing_budget" "free_tier_budget" {
  depends_on = [google_project_service.billing_budgets_api]

  billing_account = var.billing_account_id
  display_name    = "Absolute Free Tier Guardrail Budget"

  budget_filter {
    projects = ["projects/${data.google_project.current_project.number}"]
  }

  amount {
    specified_amount {
      currency_code = "MYR"
      units         = "5"
    }
  }

  threshold_rules {
    threshold_percent = 0.10 # Alert at RM 0.50 cents
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.50 # Alert at RM 2.50
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.00 # Alert at RM 5.00
    spend_basis       = "CURRENT_SPEND"
  }
}
