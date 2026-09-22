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
 Assert-Equal (Resolve-OperatorSelection '1' 1) 0 'selection first'
 foreach($text in @('0','2','-1','1;whoami','a','999999999999999999999999')){Assert-Throws {Resolve-OperatorSelection $text 1 | Out-Null} ('selection rejects '+$text)}
 Assert-Equal (Resolve-OperatorExpiry '1') 1 'expiry 1h'
 Assert-Equal (Resolve-OperatorExpiry '2') 8 'expiry 8h'
 Assert-Equal (Resolve-OperatorExpiry '3') 24 'expiry 24h'
 Assert-Equal (Resolve-OperatorExpiry '4') 0 'expiry none'
 Assert-Throws {Resolve-OperatorExpiry '1;whoami' | Out-Null} 'expiry rejects command'
 $approve=Get-OperatorControlArguments Companion Approve $requestId $authz 8
 Assert-Equal ($approve -join '|') ('-AuthzRoot|'+$authz+'|-RequestId|'+$requestId+'|-Approve|-ExpiresInHours|8') 'companion approve fixed arguments'
 $ingress=Get-OperatorControlArguments Ingress Approve $requestId $authz 0
 Assert-Equal ($ingress -join '|') ('-RequestId|'+$requestId+'|-Approve') 'ingress approve fixed arguments'
 Assert-Equal ((Get-OperatorControlArguments Companion Deny $requestId $authz) -join '|') ('-AuthzRoot|'+$authz+'|-RequestId|'+$requestId+'|-Deny') 'deny fixed arguments'
 Assert-Equal ((Get-OperatorControlArguments Ingress Revoke $grantId $authz) -join '|') ('-GrantId|'+$grantId+'|-Revoke') 'revoke fixed arguments'
 Assert-Throws {Get-OperatorControlArguments Companion Approve 'req_abc;whoami' $authz 0 | Out-Null} 'id injection rejected'
 Assert-Throws {Get-OperatorControlArguments Companion Deny $requestId $authz 8 | Out-Null} 'deny expiry rejected'
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
