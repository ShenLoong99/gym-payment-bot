output "instance_public_ip" {
  value       = google_compute_instance.free_vm.network_interface[0].access_config[0].nat_ip
  description = "Use this public IP address to connect to your app node instance"
}
