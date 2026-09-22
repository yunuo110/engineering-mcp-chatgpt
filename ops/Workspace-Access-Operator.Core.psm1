Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-OperatorPlainPath([string]$Path) {
 if($Path -cnotmatch '^[A-Za-z]:\\' -or $Path.Substring(2).Contains(':')){throw 'NOT_LOCAL_ABSOLUTE_PATH'}
 $full=[IO.Path]::GetFullPath($Path)
 $current=$full
 while($current){
  if(Test-Path -LiteralPath $current){
   $item=Get-Item -LiteralPath $current -Force
   if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE_PATH'}
  }
  $parent=Split-Path -Path $current -Parent
  if($parent -eq $current){break}
  $current=$parent
 }
 $drive=[IO.DriveInfo]::new($full.Substring(0,3))
 if($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS'){throw 'LOCAL_NTFS_REQUIRED'}
 return $full
}

function Read-OperatorJson([string]$Path,[string[]]$Required,[string[]]$Optional) {
 $full=Assert-OperatorPlainPath $Path
 if(!(Test-Path -LiteralPath $full -PathType Leaf)){throw 'AUTHZ_RECORD_NOT_FOUND'}
 $item=Get-Item -LiteralPath $full -Force
 if($item.Length -lt 2 -or $item.Length -gt 65536){throw 'AUTHZ_RECORD_INVALID'}
 try {
  $raw=[IO.File]::ReadAllText($full,[Text.UTF8Encoding]::new($false,$true))
  $value=ConvertFrom-Json -InputObject $raw -ErrorAction Stop
 } catch {throw 'AUTHZ_RECORD_INVALID'}
 if($null -eq $value -or $value -is [array] -or $value -isnot [pscustomobject]){throw 'AUTHZ_RECORD_INVALID'}
 $names=@($value.PSObject.Properties.Name)
 foreach($key in $Required){if($names -cnotcontains $key){throw 'AUTHZ_RECORD_INVALID'}}
 foreach($key in $names){if($Required -cnotcontains $key -and $Optional -cnotcontains $key){throw 'AUTHZ_RECORD_INVALID'}}
 return $value
}

function Assert-OperatorId([string]$Id,[string]$Prefix) {
 if($Id -cnotmatch ('^'+$Prefix+'[0-9a-f]{32}$')){throw 'AUTHZ_RECORD_INVALID'}
}
function Assert-OperatorDate($Value) {
 if($Value -isnot [string]){throw 'AUTHZ_RECORD_INVALID'}
 $parsed=[datetimeoffset]::MinValue
 if(![datetimeoffset]::TryParse($Value,[ref]$parsed)){throw 'AUTHZ_RECORD_INVALID'}
 return $parsed
}
function Assert-OperatorRoot($Value) {
 if($Value -isnot [string] -or $Value.Length -lt 3 -or $Value.Length -gt 1024 -or
    $Value -cnotmatch '^[A-Za-z]:[\\/]' -or $Value.Substring(2).Contains(':')){throw 'AUTHZ_RECORD_INVALID'}
}
function Assert-OperatorPermissions($Value) {
 if($Value -isnot [array] -or $Value.Count -lt 1 -or $Value.Count -gt 2){throw 'AUTHZ_RECORD_INVALID'}
 $seen=@{}
 foreach($permission in $Value){
  if($permission -cnotin @('READ','WRITE') -or $seen.ContainsKey([string]$permission)){throw 'AUTHZ_RECORD_INVALID'}
  $seen[[string]$permission]=$true
 }
}
function Assert-OperatorDirectory([string]$Path) {
 $full=Assert-OperatorPlainPath $Path
 if(!(Test-Path -LiteralPath $full -PathType Container)){throw 'AUTHZ_NOT_PROVISIONED'}
 return $full
}
function Get-OperatorSnapshot([string]$AuthzRoot) {
 $root=Assert-OperatorDirectory $AuthzRoot
 $requests=Assert-OperatorDirectory (Join-Path $root 'requests')
 $decisions=Assert-OperatorDirectory (Join-Path $root 'decisions')
 $grants=Assert-OperatorDirectory (Join-Path $root 'grants')
 $decisionByRequest=@{}
 foreach($file in @(Get-ChildItem -LiteralPath $decisions -Filter 'req_*.json' -File -Force)){
  $id=[IO.Path]::GetFileNameWithoutExtension($file.Name)
  Assert-OperatorId $id 'req_'
  $r=Read-OperatorJson $file.FullName @('schema','request_id','status','decided_at') @('grant_id')
  if($r.schema -cne 'engineering-workspace-decision/1' -or $r.request_id -cne $id -or $r.status -cnotin @('GRANTED','DENIED')){throw 'AUTHZ_RECORD_INVALID'}
  $null=Assert-OperatorDate $r.decided_at
  if($r.status -ceq 'GRANTED'){
   if($r.PSObject.Properties.Name -cnotcontains 'grant_id'){throw 'AUTHZ_RECORD_INVALID'}
   Assert-OperatorId $r.grant_id 'grant_'
  } elseif($r.PSObject.Properties.Name -ccontains 'grant_id'){throw 'AUTHZ_RECORD_INVALID'}
  $decisionByRequest[$id]=$r
 }
 $grantById=@{}
 $grantRows=@()
 foreach($file in @(Get-ChildItem -LiteralPath $grants -Filter 'grant_*.json' -File -Force)){
  $id=[IO.Path]::GetFileNameWithoutExtension($file.Name)
  Assert-OperatorId $id 'grant_'
  $r=Read-OperatorJson $file.FullName @('schema','grant_id','request_id','status','canonical_root','permissions','granted_at') @('expires_at','revoked_at')
  if($r.schema -cne 'engineering-workspace-grant/1' -or $r.grant_id -cne $id -or $r.status -cnotin @('GRANTED','REVOKED','EXPIRED')){throw 'AUTHZ_RECORD_INVALID'}
  Assert-OperatorId $r.request_id 'req_'
  Assert-OperatorRoot $r.canonical_root
  Assert-OperatorPermissions $r.permissions
  $null=Assert-OperatorDate $r.granted_at
  if($r.PSObject.Properties.Name -ccontains 'expires_at' -and $null -ne $r.expires_at){$null=Assert-OperatorDate $r.expires_at}
  if($r.PSObject.Properties.Name -ccontains 'revoked_at'){$null=Assert-OperatorDate $r.revoked_at}
  $status=$r.status
  if($status -ceq 'GRANTED' -and $r.PSObject.Properties.Name -ccontains 'expires_at' -and $null -ne $r.expires_at){
   if((Assert-OperatorDate $r.expires_at) -le [datetimeoffset]::UtcNow){$status='EXPIRED'}
  }
  $grantById[$id]=$r
  $expiry=if($r.PSObject.Properties.Name -ccontains 'expires_at'){$r.expires_at}else{$null}
  $grantRows+= [pscustomobject]@{grant_id=$id;request_id=$r.request_id;status=$status;canonical_root=$r.canonical_root;permissions=@($r.permissions);granted_at=$r.granted_at;expires_at=$expiry}
 }
 $requestRows=@()
 foreach($file in @(Get-ChildItem -LiteralPath $requests -Filter 'req_*.json' -File -Force)){
  $id=[IO.Path]::GetFileNameWithoutExtension($file.Name)
  Assert-OperatorId $id 'req_'
  $r=Read-OperatorJson $file.FullName @('schema','request_id','status','workspace_root','permissions','created_at') @('reason')
  if($r.schema -cne 'engineering-workspace-request/1' -or $r.request_id -cne $id -or $r.status -cne 'REQUESTED'){throw 'AUTHZ_RECORD_INVALID'}
  Assert-OperatorRoot $r.workspace_root
  Assert-OperatorPermissions $r.permissions
  $null=Assert-OperatorDate $r.created_at
  if($r.PSObject.Properties.Name -ccontains 'reason' -and ($r.reason -isnot [string] -or $r.reason.Length -lt 1 -or $r.reason.Length -gt 2000)){throw 'AUTHZ_RECORD_INVALID'}
  $status='REQUESTED'
  if($decisionByRequest.ContainsKey($id)){
   $d=$decisionByRequest[$id]
   $status=$d.status
   if($status -ceq 'GRANTED'){
    if(!$grantById.ContainsKey($d.grant_id) -or $grantById[$d.grant_id].request_id -cne $id){throw 'AUTHZ_RECORD_INVALID'}
    $status=@($grantRows | Where-Object {$_.grant_id -ceq $d.grant_id})[0].status
   }
  }
  $reason=if($r.PSObject.Properties.Name -ccontains 'reason'){$r.reason}else{$null}
  $requestRows+= [pscustomobject]@{request_id=$id;status=$status;workspace_root=$r.workspace_root;permissions=@($r.permissions);created_at=$r.created_at;reason=$reason}
 }
 foreach($id in $decisionByRequest.Keys){if(@($requestRows | Where-Object {$_.request_id -ceq $id}).Count -ne 1){throw 'AUTHZ_RECORD_INVALID'}}
 return [pscustomobject]@{Requests=@($requestRows | Sort-Object created_at,request_id);Grants=@($grantRows | Sort-Object granted_at,grant_id)}
}

function Resolve-OperatorSelection([string]$Text,[int]$Count) {
 if($Text -cnotmatch '^[1-9][0-9]*$'){throw 'SELECTION_INVALID'}
 $number=0
 if(![int]::TryParse($Text,[ref]$number) -or $number -gt $Count){throw 'SELECTION_INVALID'}
 return $number-1
}
function Resolve-OperatorExpiry([string]$Text) {
 switch -CaseSensitive ($Text) {
  '1' {return 1}
  '2' {return 8}
  '3' {return 24}
  '4' {return 0}
  default {throw 'EXPIRY_INVALID'}
 }
}
function Get-OperatorControlArguments([string]$Mode,[string]$Action,[string]$Id,[string]$AuthzRoot,[int]$ExpiresInHours=0) {
 if($Mode -cnotin @('Companion','Ingress') -or $Action -cnotin @('Approve','Deny','Revoke')){throw 'ACTION_INVALID'}
 if($Action -ceq 'Revoke'){Assert-OperatorId $Id 'grant_'}else{Assert-OperatorId $Id 'req_'}
 if($ExpiresInHours -cnotin @(0,1,8,24) -or ($Action -cne 'Approve' -and $ExpiresInHours -ne 0)){throw 'EXPIRY_INVALID'}
 $args=@()
 if($Mode -ceq 'Companion'){$args+=@('-AuthzRoot',$AuthzRoot)}
 if($Action -ceq 'Revoke'){$args+=@('-GrantId',$Id,'-Revoke')}
 else {$args+=@('-RequestId',$Id,('-'+$Action))}
 if($ExpiresInHours){$args+=@('-ExpiresInHours',[string]$ExpiresInHours)}
 return ,$args
}
function Get-OperatorNewRequests($Snapshot,[hashtable]$Seen) {
 $rows=@()
 foreach($r in @($Snapshot.Requests | Where-Object {$_.status -ceq 'REQUESTED'})){
  if(!$Seen.ContainsKey($r.request_id)){$Seen[$r.request_id]=$true;$rows+=$r}
 }
 return ,$rows
}
function Format-OperatorDisplayText([string]$Value) {
 return ($Value -replace '[\x00-\x1f\x7f]','?')
}
function Format-OperatorReason([string]$Value) {
 if($Value -match '(?i)(token|secret|password|bearer|authorization|api.key|eyJ[A-Za-z0-9_-]{12})'){return '[redacted]'}
 return Format-OperatorDisplayText $Value
}
Export-ModuleMember -Function Assert-OperatorPlainPath,Read-OperatorJson,Get-OperatorSnapshot,Resolve-OperatorSelection,Resolve-OperatorExpiry,Get-OperatorControlArguments,Get-OperatorNewRequests,Format-OperatorDisplayText,Format-OperatorReason
