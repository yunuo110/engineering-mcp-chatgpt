# Local operator control plane for Workspace Access V1.
# Chat-facing MCP intentionally has no approve/deny/revoke tool.
[CmdletBinding(DefaultParameterSetName='Approve')]
param(
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^[A-Za-z]:\\')]
 [string]$AuthzRoot,

 [Parameter(Mandatory=$true,ParameterSetName='Approve')]
 [Parameter(Mandatory=$true,ParameterSetName='Deny')]
 [ValidatePattern('^req_[0-9a-f]{32}$')]
 [string]$RequestId,

 [Parameter(Mandatory=$true,ParameterSetName='Approve')]
 [switch]$Approve,

 [Parameter(Mandatory=$true,ParameterSetName='Deny')]
 [switch]$Deny,

 [Parameter(Mandatory=$true,ParameterSetName='Revoke')]
 [switch]$Revoke,

 [Parameter(Mandatory=$true,ParameterSetName='Revoke')]
 [ValidatePattern('^grant_[0-9a-f]{32}$')]
 [string]$GrantId,

 [Parameter(ParameterSetName='Approve')]
 [ValidateRange(1,8760)]
 [int]$ExpiresInHours
)
$ErrorActionPreference='Stop'

function Assert-Administrator {
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ELEVATION_REQUIRED'}
}
function Assert-Plain([string]$Path){
 if($Path -cnotmatch '^[A-Z]:\\' -or $Path.Substring(2).Contains(':')){throw 'NOT_LOCAL_ABSOLUTE_PATH'}
 $current=$Path
 while($current){
  if(Test-Path -LiteralPath $current){
   $item=Get-Item -LiteralPath $current -Force
   if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'REPARSE_PATH'}
  }
  $current=Split-Path -Path $current -Parent
 }
 $drive=[IO.DriveInfo]::new($Path.Substring(0,3))
 if($drive.DriveType-ne[IO.DriveType]::Fixed -or $drive.DriveFormat-cne'NTFS'){throw 'LOCAL_NTFS_REQUIRED'}
}

Assert-Administrator
$root=[IO.Path]::GetFullPath($AuthzRoot).TrimEnd('\\')
Assert-Plain $root
foreach($name in @('requests','decisions','grants')){
 $p=Join-Path $root $name
 Assert-Plain $p
 if(!(Test-Path -LiteralPath $p -PathType Container)){throw 'AUTHZ_NOT_PROVISIONED'}
 if(((Get-Item -LiteralPath $p -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'AUTHZ_REPARSE_FORBIDDEN'}
}

function Read-StrictJson([string]$Path,[string[]]$Required,[string[]]$Optional=@()){
 Assert-Plain $Path
 if(!(Test-Path -LiteralPath $Path -PathType Leaf)){throw 'AUTHZ_RECORD_NOT_FOUND'}
 $item=Get-Item -LiteralPath $Path -Force
 if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0 -or $item.Length-lt2 -or $item.Length-gt65536){throw 'AUTHZ_RECORD_INVALID'}
 $raw=[IO.File]::ReadAllText($Path,[Text.UTF8Encoding]::new($false,$true))
 $value=$raw|ConvertFrom-Json
 $names=@($value.PSObject.Properties.Name)
 foreach($k in $Required){if($names-cnotcontains$k){throw 'AUTHZ_RECORD_INVALID'}}
 foreach($k in $names){if($Required-cnotcontains$k -and $Optional-cnotcontains$k){throw 'AUTHZ_RECORD_INVALID'}}
 return $value
}
function Write-NewRecord([string]$Path,$Value){
 Assert-Plain $Path
 if(Test-Path -LiteralPath $Path){throw 'AUTHZ_RECORD_ALREADY_EXISTS'}
 $text=$Value|ConvertTo-Json -Compress -Depth 8
 if([Text.Encoding]::UTF8.GetByteCount($text)-gt65536){throw 'AUTHZ_RECORD_TOO_LARGE'}
 $fs=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes($text)
  $fs.Write($bytes,0,$bytes.Length)
  $fs.Flush($true)
 }finally{$fs.Dispose()}
}
function Write-Replacement([string]$Path,$Value){
 Assert-Plain $Path
 if(!(Test-Path -LiteralPath $Path -PathType Leaf)){throw 'AUTHZ_RECORD_NOT_FOUND'}
 $parent=Split-Path $Path -Parent
 $stage=Join-Path $parent ('.stage-'+[Guid]::NewGuid().ToString('N')+'.json')
 $backup=Join-Path $parent ('.backup-'+[Guid]::NewGuid().ToString('N')+'.json')
 try{
  Write-NewRecord $stage $Value
  [IO.File]::Replace($stage,$Path,$backup,$true)
  Remove-Item -LiteralPath $backup -Force
 }finally{
  if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Force}
  if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Force}
 }
}
function Canonical-WorkspaceRoot([string]$Raw){
 if([string]::IsNullOrWhiteSpace($Raw)-or$Raw.Length-gt1024){throw 'WORKSPACE_ROOT_INVALID'}
 if($Raw-cmatch'^(\\\\|//|\\\\\?\\|\\\\\.\\)' -or $Raw-cnotmatch'^[A-Za-z]:[\\/]' -or $Raw.Substring(2).Contains(':')){throw 'WORKSPACE_ROOT_INVALID'}
 $full=[IO.Path]::GetFullPath($Raw).TrimEnd('\')
 Assert-Plain $full
 if(!(Test-Path -LiteralPath $full -PathType Container)){throw 'WORKSPACE_ROOT_MISSING'}
 $item=Get-Item -LiteralPath $full -Force
 if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'WORKSPACE_ROOT_REPARSE'}
 # Resolve the final path once at approval time; request text never becomes authority.
 $resolved=$item.FullName.TrimEnd('\')
 if($resolved-cne$full){throw 'WORKSPACE_ROOT_CANONICAL_MISMATCH'}
 return $resolved
}

$requests=Join-Path $root 'requests'
$decisions=Join-Path $root 'decisions'
$grants=Join-Path $root 'grants'
$now=[DateTime]::UtcNow

if($PSCmdlet.ParameterSetName-eq'Revoke'){
 $grantPath=Join-Path $grants ($GrantId+'.json')
 $g=Read-StrictJson $grantPath @('schema','grant_id','request_id','status','canonical_root','permissions','granted_at') @('expires_at','revoked_at')
 if($g.schema-cne'engineering-workspace-grant/1' -or $g.grant_id-cne$GrantId){throw 'AUTHZ_RECORD_INVALID'}
 if($g.status-cne'GRANTED'){throw 'GRANT_NOT_ACTIVE'}
 $next=[ordered]@{
  schema='engineering-workspace-grant/1';grant_id=$g.grant_id;request_id=$g.request_id;status='REVOKED'
  canonical_root=$g.canonical_root;permissions=@($g.permissions);granted_at=$g.granted_at
 }
 if($g.PSObject.Properties.Name-ccontains'expires_at'){$next.expires_at=$g.expires_at}
 $next.revoked_at=$now.ToString('o')
 if((Read-Host ('Type REVOKE '+$GrantId))-cne('REVOKE '+$GrantId)){throw 'REVOKE_NOT_ACKNOWLEDGED'}
 Write-Replacement $grantPath $next
 [ordered]@{status='REVOKED';grant_id=$GrantId;workspace_acl='UNCHANGED';production_ledger='UNCHANGED'}|ConvertTo-Json -Compress
 exit 0
}

$requestPath=Join-Path $requests ($RequestId+'.json')
$r=Read-StrictJson $requestPath @('schema','request_id','status','workspace_root','permissions','created_at') @('reason')
if($r.schema-cne'engineering-workspace-request/1' -or $r.request_id-cne$RequestId -or $r.status-cne'REQUESTED'){throw 'AUTHZ_RECORD_INVALID'}
$perms=@($r.permissions)
if($perms.Count-lt1 -or$perms.Count-gt2 -or @($perms|Where-Object {$_-notin@('READ','WRITE')}).Count){throw 'AUTHZ_RECORD_INVALID'}
$decisionPath=Join-Path $decisions ($RequestId+'.json')
if(Test-Path -LiteralPath $decisionPath){throw 'REQUEST_ALREADY_DECIDED'}

if($PSCmdlet.ParameterSetName-eq'Deny'){
 if((Read-Host ('Type DENY '+$RequestId))-cne('DENY '+$RequestId)){throw 'DENY_NOT_ACKNOWLEDGED'}
 Write-NewRecord $decisionPath ([ordered]@{
  schema='engineering-workspace-decision/1';request_id=$RequestId;status='DENIED';decided_at=$now.ToString('o')
 })
 [ordered]@{status='DENIED';request_id=$RequestId;workspace_acl='UNCHANGED';production_ledger='UNCHANGED'}|ConvertTo-Json -Compress
 exit 0
}

$canonical=Canonical-WorkspaceRoot ([string]$r.workspace_root)
$grantId='grant_'+[Guid]::NewGuid().ToString('N')
$grant=[ordered]@{
 schema='engineering-workspace-grant/1';grant_id=$grantId;request_id=$RequestId;status='GRANTED'
 canonical_root=$canonical;permissions=$perms;granted_at=$now.ToString('o')
}
if($ExpiresInHours){$grant.expires_at=$now.AddHours($ExpiresInHours).ToString('o')}
$summary=($canonical+' ['+($perms-join',')+']')
if((Read-Host ('Type APPROVE '+$RequestId+' '+$summary))-cne('APPROVE '+$RequestId+' '+$summary)){throw 'APPROVE_NOT_ACKNOWLEDGED'}
Write-NewRecord (Join-Path $grants ($grantId+'.json')) $grant
try{
 Write-NewRecord $decisionPath ([ordered]@{
  schema='engineering-workspace-decision/1';request_id=$RequestId;status='GRANTED';grant_id=$grantId;decided_at=$now.ToString('o')
 })
}catch{
 # A grant without a decision is not discoverable from the request and remains fail-closed.
 throw
}
[ordered]@{status='GRANTED';request_id=$RequestId;grant_id=$grantId;canonical_root=$canonical;permissions=$perms;expires_at=$grant.expires_at;workspace_acl='UNCHANGED';production_ledger='UNCHANGED'}|ConvertTo-Json -Compress


