# PowerShell script to add Windows Firewall rule for Node.js backend
# Run as Administrator

Write-Host "Adding Windows Firewall rule for port 3000..." -ForegroundColor Green

# Remove existing rule if it exists
Remove-NetFirewallRule -DisplayName "Bestie Backend Port 3000" -ErrorAction SilentlyContinue

# Add new inbound rule
New-NetFirewallRule `
    -DisplayName "Bestie Backend Port 3000" `
    -Direction Inbound `
    -LocalPort 3000 `
    -Protocol TCP `
    -Action Allow `
    -Profile Any `
    -Enabled True

Write-Host "Firewall rule added successfully!" -ForegroundColor Green
Write-Host "Port 3000 is now accessible from other devices on the network." -ForegroundColor Cyan
