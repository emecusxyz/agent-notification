$ErrorActionPreference = 'Stop'

if (-not (Get-Module -ListAvailable -Name BurntToast)) {
    Install-Module BurntToast -Scope CurrentUser -Repository PSGallery -Force
}

Import-Module BurntToast
New-BurntToastNotification -Text @(
    'BurntToast installed',
    'Your Windows notification agent can now display toast notifications.'
)
