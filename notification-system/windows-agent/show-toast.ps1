param(
    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 150)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 1000)]
    [string]$Message
)

$ErrorActionPreference = 'Stop'

try {
    Import-Module BurntToast -ErrorAction Stop
    New-BurntToastNotification -Text @($Title, $Message) -ErrorAction Stop
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
