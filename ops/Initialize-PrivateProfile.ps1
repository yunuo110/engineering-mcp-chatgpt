[CmdletBinding()]
param(
 [string]$ConfigPath='C:\EngineeringMCPChatGPT\config\local.private.json',
 [string]$AuthzRoot='C:\ProgramData\EngineeringMCPChatGPT\authz'
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $ConfigPath){throw 'CONFIG_ALREADY_EXISTS'}
if($ConfigPath -cnotmatch '^[A-Za-z]:\\' -or $AuthzRoot -cnotmatch '^[A-Za-z]:\\'){throw 'LOCAL_ABSOLUTE_PATH_REQUIRED'}
$configParent=Split-Path -Path $ConfigPath -Parent
New-Item -ItemType Directory -Path $configParent -Force|Out-Null
New-Item -ItemType Directory -Path $AuthzRoot -Force|Out-Null
foreach($name in @('requests','decisions','grants')){
 New-Item -ItemType Directory -Path (Join-Path $AuthzRoot $name) -Force|Out-Null
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\config\private.example.json') -Destination $ConfigPath
Write-Output ('CONFIG_CREATED='+$ConfigPath)
Write-Output ('AUTHZ_ROOT_CREATED='+$AuthzRoot)
Write-Output 'NEXT=Set the trusted Engineering MCP executable and canonical repository, keep contractVersion engineering-c2c/1, then review filesystem permissions before start.'
