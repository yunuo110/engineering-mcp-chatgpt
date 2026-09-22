# Local Workspace Access approval UI. Request data is display-only; all decisions use the existing control script.
[CmdletBinding()]
param(
 [ValidateSet('Companion','Ingress')][string]$Mode='Companion',
 [string]$ConfigPath,
 [string]$IngressOpsPath,
 [switch]$Watch
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Workspace-Access-Operator.Core.psm1') -Force

function Assert-Administrator {
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ELEVATION_REQUIRED: start an Administrator PowerShell for approval.'}
}
function Get-Binding {
 if($Mode -ceq 'Ingress'){
  if($ConfigPath -or !$IngressOpsPath){throw 'INGRESS_OPS_PATH_REQUIRED'}
  $ops=Assert-OperatorPlainPath $IngressOpsPath
  $common=Assert-OperatorPlainPath (Join-Path $ops 'Ingress.Common.psm1')
  $control=Assert-OperatorPlainPath (Join-Path $ops 'Workspace-Access-Control.ps1')
  if(!(Test-Path -LiteralPath $common -PathType Leaf) -or !(Test-Path -LiteralPath $control -PathType Leaf)){throw 'INGRESS_CONTROL_NOT_FOUND'}
  Import-Module $common -Force
  $constants=Get-Constants
  if($null -eq $constants -or $constants.Data -isnot [string]){throw 'INGRESS_CONSTANTS_INVALID'}
  $root=Assert-OperatorPlainPath (Join-Path $constants.Data 'authz')
  return [pscustomobject]@{Mode=$Mode;Root=$root;Control=$control}
 }
 if($IngressOpsPath){throw 'COMPANION_CONFIG_REQUIRED'}
 if(!$ConfigPath){$ConfigPath=$env:ENGINEERING_MCP_CHATGPT_CONFIG}
 if(!$ConfigPath){throw 'COMPANION_CONFIG_REQUIRED: pass -ConfigPath or set ENGINEERING_MCP_CHATGPT_CONFIG.'}
 $config=Read-OperatorJson $ConfigPath @('profile','server','auth','core','workspaceAccess') @()
 if($config.workspaceAccess -isnot [pscustomobject] -or @($config.workspaceAccess.PSObject.Properties.Name).Count -ne 1 -or
    $config.workspaceAccess.PSObject.Properties.Name -cnotcontains 'authzRoot' -or $config.workspaceAccess.authzRoot -isnot [string]){throw 'COMPANION_CONFIG_INVALID'}
 $root=Assert-OperatorPlainPath $config.workspaceAccess.authzRoot
 $control=Assert-OperatorPlainPath (Join-Path $PSScriptRoot 'Workspace-Access-Control.ps1')
 if(!(Test-Path -LiteralPath $control -PathType Leaf)){throw 'COMPANION_CONTROL_NOT_FOUND'}
 return [pscustomobject]@{Mode=$Mode;Root=$root;Control=$control}
}
function Show-Request($Row,[int]$Index) {
 $path=Format-OperatorDisplayText $Row.workspace_root
 $reason=''
 if($null -ne $Row.reason){$reason=Format-OperatorReason $Row.reason}
 Write-Host ('[{0}] {1}  {2} [{3}]' -f $Index,$Row.request_id,$path,($Row.permissions -join ','))
 Write-Host ('    created_at: {0}' -f $Row.created_at)
 if($reason){Write-Host ('    reason: {0}' -f $reason)}
}
function Show-Grant($Row,[int]$Index) {
 $path=Format-OperatorDisplayText $Row.canonical_root
 Write-Host ('[{0}] {1}  {2} [{3}]  {4}' -f $Index,$Row.grant_id,$path,($Row.permissions -join ','),$Row.status)
 if($Row.expires_at){Write-Host ('    expires_at: {0}' -f $Row.expires_at)}
}
function Invoke-Decision([string]$Action,$Row,[int]$Hours=0) {
 $id=if($Action -ceq 'Revoke'){$Row.grant_id}else{$Row.request_id}
 $latest=Get-OperatorSnapshot $binding.Root
 if($Action -ceq 'Revoke'){
  if(@($latest.Grants | Where-Object {$_.grant_id -ceq $id -and $_.status -ceq 'GRANTED'}).Count -ne 1){throw 'GRANT_NOT_ACTIVE'}
 } elseif(@($latest.Requests | Where-Object {$_.request_id -ceq $id -and $_.status -ceq 'REQUESTED'}).Count -ne 1){throw 'REQUEST_ALREADY_DECIDED'}
 $arguments=Get-OperatorControlArguments $binding.Mode $Action $id $binding.Root $Hours
 Write-Host ('The control script will require its exact typed {0} acknowledgement.' -f $Action.ToUpperInvariant())
 & $binding.Control @arguments
}
function Read-Index([int]$Count) {
 $raw=Read-Host 'Select index'
 return Resolve-OperatorSelection $raw $Count
}

if(!$Watch){Assert-Administrator}
$binding=Get-Binding
$null=Get-OperatorSnapshot $binding.Root

if($Watch){
 Write-Host ('Watching Workspace Access requests under {0}. Press Ctrl+C to stop.' -f $binding.Root)
 $seen=@{}
 $originalTitle=$Host.UI.RawUI.WindowTitle
 try {
  while($true){
   $snapshot=Get-OperatorSnapshot $binding.Root
   $fresh=Get-OperatorNewRequests $snapshot $seen
   foreach($r in $fresh){
    $path=Format-OperatorDisplayText $r.workspace_root
    Write-Host ('Workspace access request: {0} [{1}] {2}' -f $path,($r.permissions -join ','),$r.request_id.Substring(0,12))
    try{[Console]::Beep()}catch{}
    try{$Host.UI.RawUI.WindowTitle='WORKSPACE ACCESS REQUEST ('+$fresh.Count+')'}catch{}
   }
   Start-Sleep -Seconds 2
   try{$Host.UI.RawUI.WindowTitle=$originalTitle}catch{}
  }
 } finally {try{$Host.UI.RawUI.WindowTitle=$originalTitle}catch{}}
}

while($true){
 try {
  $snapshot=Get-OperatorSnapshot $binding.Root
  $pending=@($snapshot.Requests | Where-Object {$_.status -ceq 'REQUESTED'})
  Write-Host ''
  Write-Host ('Engineering MCP Workspace Access - {0} pending' -f $pending.Count)
  for($i=0;$i -lt $pending.Count;$i++){Show-Request $pending[$i] ($i+1)}
  Write-Host '[A] Approve  [D] Deny  [R] Refresh  [G] Grants  [V] Revoke  [Q] Quit'
  $action=(Read-Host 'Action').ToUpperInvariant()
  switch -CaseSensitive ($action) {
   'Q' {return}
   'R' {continue}
   'A' {
    $index=Read-Index $pending.Count
    Write-Host '[1] 1h  [2] 8h  [3] 24h  [4] no expiry'
    $hours=Resolve-OperatorExpiry (Read-Host 'Expiry')
    Invoke-Decision 'Approve' $pending[$index] $hours
   }
   'D' {$index=Read-Index $pending.Count;Invoke-Decision 'Deny' $pending[$index]}
   'G' {
    $active=@($snapshot.Grants | Where-Object {$_.status -ceq 'GRANTED'})
    Write-Host ('Active grants: {0}' -f $active.Count)
    for($i=0;$i -lt $active.Count;$i++){Show-Grant $active[$i] ($i+1)}
   }
   'V' {
    $active=@($snapshot.Grants | Where-Object {$_.status -ceq 'GRANTED'})
    Write-Host ('Active grants: {0}' -f $active.Count)
    for($i=0;$i -lt $active.Count;$i++){Show-Grant $active[$i] ($i+1)}
    $index=Read-Index $active.Count
    Invoke-Decision 'Revoke' $active[$index]
   }
   default {Write-Host 'Unknown action.'}
  }
 } catch {Write-Host ('Action stopped: '+$_.Exception.Message)}
}
