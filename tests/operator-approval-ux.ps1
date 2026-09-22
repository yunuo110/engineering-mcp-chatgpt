$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\ops\Workspace-Access-Operator.Core.psm1') -Force

function Assert-Equal($Actual,$Expected,[string]$Name){
 if($Actual -cne $Expected){throw ('TEST_FAILED '+$Name+': '+$Actual+' != '+$Expected)}
}
function Assert-Throws([scriptblock]$Action,[string]$Name){
 $threw=$false
 try{& $Action}catch{$threw=$true}
 if(!$threw){throw ('TEST_FAILED '+$Name)}
}
function Write-Json([string]$Path,$Value){
 [IO.File]::WriteAllText($Path,($Value | ConvertTo-Json -Depth 8 -Compress),[Text.UTF8Encoding]::new($false))
}
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$base=Join-Path $temp ('engineering-operator-ux-test-'+[Guid]::NewGuid().ToString('N'))
if(!$base.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw 'TEST_BOUNDARY_INVALID'}
try{
 New-Item -ItemType Directory -Path $base | Out-Null
 $authz=Join-Path $base 'authz'
 foreach($dir in @($authz,(Join-Path $authz 'requests'),(Join-Path $authz 'decisions'),(Join-Path $authz 'grants'))){New-Item -ItemType Directory -Path $dir | Out-Null}
 $requestId='req_'+('a'*32)
 $grantId='grant_'+('b'*32)
 $date='2026-09-22T00:00:00.000Z'
 $requestPath=Join-Path $authz ('requests\'+$requestId+'.json')
 $decisionPath=Join-Path $authz ('decisions\'+$requestId+'.json')
 $grantPath=Join-Path $authz ('grants\'+$grantId+'.json')
 $request=[ordered]@{schema='engineering-workspace-request/1';request_id=$requestId;status='REQUESTED';workspace_root='F:\code\game-product';permissions=@('READ');created_at=$date;reason='inspect code'}
 $grant=[ordered]@{schema='engineering-workspace-grant/1';grant_id=$grantId;request_id=$requestId;status='GRANTED';canonical_root='F:\code\game-product';permissions=@('READ');granted_at=$date}
 Write-Json $requestPath $request
 $snapshot=Get-OperatorSnapshot $authz
 Write-Output 'CHECKPOINT: pending discovery'
 Assert-Equal $snapshot.Requests.Count 1 'pending discovery count'
 Assert-Equal $snapshot.Requests[0].status 'REQUESTED' 'pending status'
 $seen=@{}
 Assert-Equal (Get-OperatorNewRequests $snapshot $seen).Count 1 'watch first alert'
 Assert-Equal (Get-OperatorNewRequests $snapshot $seen).Count 0 'watch dedupe'
 Write-Json $decisionPath ([ordered]@{schema='engineering-workspace-decision/1';request_id=$requestId;status='DENIED';decided_at=$date})
 Assert-Equal (Get-OperatorSnapshot $authz).Requests[0].status 'DENIED' 'denied classification'
 Write-Json $grantPath $grant
 Write-Json $decisionPath ([ordered]@{schema='engineering-workspace-decision/1';request_id=$requestId;status='GRANTED';grant_id=$grantId;decided_at=$date})
 Assert-Equal (Get-OperatorSnapshot $authz).Requests[0].status 'GRANTED' 'granted classification'
 $grant.status='REVOKED';$grant.revoked_at=$date
 Write-Json $grantPath $grant
 Assert-Equal (Get-OperatorSnapshot $authz).Grants[0].status 'REVOKED' 'revoked classification'
 $grant.status='GRANTED';$grant.Remove('revoked_at');$grant.expires_at='2020-01-01T00:00:00.000Z'
 Write-Json $grantPath $grant
 Assert-Equal (Get-OperatorSnapshot $authz).Grants[0].status 'EXPIRED' 'expired classification'
 $grant.expires_at=$null
 Write-Json $grantPath $grant
 Assert-Throws {Get-OperatorSnapshot $authz | Out-Null} 'null expiry fails closed'
 $grant.expires_at='2020-01-01T00:00:00.000Z'
 Write-Json $grantPath $grant
 Write-Output 'CHECKPOINT: lifecycle classification'
 [IO.File]::WriteAllText($requestPath,'{bad json')
 Assert-Throws {Get-OperatorSnapshot $authz | Out-Null} 'malformed JSON fails closed'
 Write-Json $requestPath $request
 $request.unexpected='x'
 Write-Json $requestPath $request
 Assert-Throws {Get-OperatorSnapshot $authz | Out-Null} 'extra field fails closed'
 $request.Remove('unexpected')
 Write-Json $requestPath $request
 [IO.File]::WriteAllText($requestPath,(' ' * 65537))
 Assert-Throws {Get-OperatorSnapshot $authz | Out-Null} 'oversized record fails closed'
 Write-Json $requestPath $request
 Assert-Equal (Format-OperatorReason 'api_key=abc123') '[redacted]' 'reason secret redaction'
 Assert-Equal (Format-OperatorReason "inspect`nsource") 'inspect?source' 'reason control character'
 Write-Output 'CHECKPOINT: malformed and oversized records'
 Assert-Equal (Resolve-OperatorSelection '1' 1) 0 'selection first'
 foreach($text in @('0','2','-1','1;whoami','a','999999999999999999999999')){Assert-Throws {Resolve-OperatorSelection $text 1 | Out-Null} ('selection rejects '+$text)}
 Assert-Equal (Resolve-OperatorExpiry '1') 1 'expiry 1h'
 Assert-Equal (Resolve-OperatorExpiry '2') 8 'expiry 8h'
 Assert-Equal (Resolve-OperatorExpiry '3') 24 'expiry 24h'
 Assert-Equal (Resolve-OperatorExpiry '4') 0 'expiry none'
 Assert-Throws {Resolve-OperatorExpiry '1;whoami' | Out-Null} 'expiry rejects command'
 $approve=Get-OperatorControlParameters Companion Approve $requestId $authz 8
 Assert-Equal $approve.AuthzRoot $authz 'companion approve authz root'
 Assert-Equal $approve.RequestId $requestId 'companion approve request id'
 Assert-Equal $approve.Approve $true 'companion approve switch'
 Assert-Equal $approve.ExpiresInHours 8 'companion approve expiry'
 $ingress=Get-OperatorControlParameters Ingress Approve $requestId $authz 0
 Assert-Equal $ingress.ContainsKey('AuthzRoot') $false 'ingress omits authz root'
 Assert-Equal $ingress.RequestId $requestId 'ingress approve request id'
 Assert-Equal $ingress.Approve $true 'ingress approve switch'
 Assert-Equal $ingress.ContainsKey('ExpiresInHours') $false 'ingress no-expiry omitted'
 $deny=Get-OperatorControlParameters Companion Deny $requestId $authz
 Assert-Equal $deny.AuthzRoot $authz 'deny authz root'
 Assert-Equal $deny.RequestId $requestId 'deny request id'
 Assert-Equal $deny.Deny $true 'deny switch'
 $revoke=Get-OperatorControlParameters Ingress Revoke $grantId $authz
 Assert-Equal $revoke.GrantId $grantId 'revoke grant id'
 Assert-Equal $revoke.Revoke $true 'revoke switch'
 Assert-Throws {Get-OperatorControlParameters Companion Approve 'req_abc;whoami' $authz 0 | Out-Null} 'id injection rejected'
 Assert-Throws {Get-OperatorControlParameters Companion Deny $requestId $authz 8 | Out-Null} 'deny expiry rejected'

 $companionMock=Join-Path $base 'companion-control.ps1'
 $ingressMock=Join-Path $base 'ingress-control.ps1'
 @'
param(
 [string]$AuthzRoot,
 [string]$RequestId,
 [switch]$Approve,
 [switch]$Deny,
 [switch]$Revoke,
 [string]$GrantId,
 [int]$ExpiresInHours=0
)
[ordered]@{
 AuthzRoot=$AuthzRoot;RequestId=$RequestId;Approve=[bool]$Approve;Deny=[bool]$Deny;
 Revoke=[bool]$Revoke;GrantId=$GrantId;ExpiresInHours=$ExpiresInHours
} | ConvertTo-Json -Compress
'@ | Set-Content -LiteralPath $companionMock -Encoding UTF8
 @'
param(
 [string]$RequestId,
 [switch]$Approve,
 [switch]$Deny,
 [switch]$Revoke,
 [string]$GrantId,
 [int]$ExpiresInHours=0
)
[ordered]@{
 RequestId=$RequestId;Approve=[bool]$Approve;Deny=[bool]$Deny;
 Revoke=[bool]$Revoke;GrantId=$GrantId;ExpiresInHours=$ExpiresInHours
} | ConvertTo-Json -Compress
'@ | Set-Content -LiteralPath $ingressMock -Encoding UTF8

 $params=Get-OperatorControlParameters Ingress Approve $requestId $authz 0
 $bound=(& $ingressMock @params | ConvertFrom-Json)
 Assert-Equal $bound.RequestId $requestId 'ingress binding approve request id'
 Assert-Equal $bound.Approve $true 'ingress binding approve switch'
 Assert-Equal $bound.ExpiresInHours 0 'ingress binding no expiry'

 $params=Get-OperatorControlParameters Ingress Approve $requestId $authz 8
 $bound=(& $ingressMock @params | ConvertFrom-Json)
 Assert-Equal $bound.RequestId $requestId 'ingress binding approve 8h request id'
 Assert-Equal $bound.Approve $true 'ingress binding approve 8h switch'
 Assert-Equal $bound.ExpiresInHours 8 'ingress binding approve 8h expiry'

 $params=Get-OperatorControlParameters Ingress Deny $requestId $authz 0
 $bound=(& $ingressMock @params | ConvertFrom-Json)
 Assert-Equal $bound.RequestId $requestId 'ingress binding deny request id'
 Assert-Equal $bound.Deny $true 'ingress binding deny switch'

 $params=Get-OperatorControlParameters Ingress Revoke $grantId $authz 0
 $bound=(& $ingressMock @params | ConvertFrom-Json)
 Assert-Equal $bound.GrantId $grantId 'ingress binding revoke grant id'
 Assert-Equal $bound.Revoke $true 'ingress binding revoke switch'

 $params=Get-OperatorControlParameters Companion Approve $requestId $authz 8
 $bound=(& $companionMock @params | ConvertFrom-Json)
 Assert-Equal $bound.AuthzRoot $authz 'companion binding authz root'
 Assert-Equal $bound.RequestId $requestId 'companion binding request id'
 Assert-Equal $bound.Approve $true 'companion binding approve switch'
 Assert-Equal $bound.ExpiresInHours 8 'companion binding expiry'
 Write-Output 'CHECKPOINT: input, parameters, and script binding'
 $outside=Join-Path $base 'outside'
 New-Item -ItemType Directory -Path $outside | Out-Null
 $link=Join-Path $base 'linked-authz'
 try {
  New-Item -ItemType Junction -Path $link -Target $authz -ErrorAction Stop | Out-Null
  Assert-Throws {Get-OperatorSnapshot $link | Out-Null} 'junction root rejected'
  [IO.Directory]::Delete($link)
 } catch {
  if(Test-Path -LiteralPath $link){throw}
  Write-Output 'JUNCTION_TEST_SKIPPED: link creation unavailable'
 }
 Write-Output 'OPERATOR_UX_TESTS_PASS'
} finally {
 if(Test-Path -LiteralPath $base){
  if(!$base.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($base) -notlike 'engineering-operator-ux-test-*'){throw 'TEST_BOUNDARY_INVALID'}
  Remove-Item -LiteralPath $base -Recurse -Force
 }
}
