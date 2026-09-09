$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5000/api'
$ProgressPreference = 'SilentlyContinue'
# 后端返回 UTF-8 中文，PowerShell 5.1 默认按系统代码页解码会乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show($name, $obj) {
  Write-Host "--- $name ---" -ForegroundColor Cyan
  $obj | ConvertTo-Json -Depth 4 -Compress | ForEach-Object { if ($_.Length -gt 700) { $_.Substring(0,700) + ' ...[truncated]' } else { $_ } }
}

# Windows PowerShell 5.1 的 Invoke-WebRequest 依赖 IE 引擎，处理二进制响应必须加 -UseBasicParsing
function Get-Binary($url, $headers) {
  Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing
}

# 1. health
Show 'GET /health' (Invoke-RestMethod "$base/health")

# 2. login
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username='admin'; password='password' } | ConvertTo-Json)
Show 'POST /auth/login' @{ success = $login.success; user = $login.data.user.displayName; tokenLen = $login.data.token.Length }
$h = @{ Authorization = "Bearer $($login.data.token)" }

# 3. meta
$meta = Invoke-RestMethod "$base/meta" -Headers $h
Show 'GET /meta' @{ mailChannel = $meta.data.mailChannel; placeholders = $meta.data.placeholders.Count; company = $meta.data.company.name }
Write-Host "placeholders = $(($meta.data.placeholders | ForEach-Object { $_.token }) -join ' ')"

# 4. customers list
$list = Invoke-RestMethod "$base/customers?page=1&limit=3&sortBy=updatedAt&sortOrder=desc" -Headers $h
Show 'GET /customers' @{ total = $list.data.total; totalPages = $list.data.totalPages; first = $list.data.items[0].name; firstId = $list.data.items[0].id; letterCount = $list.data.items[0].letterCount }
$cid = $list.data.items[0].id

# 5. filter by status
$pending = Invoke-RestMethod "$base/customers?status=pending&limit=100" -Headers $h
Write-Host "--- GET /customers?status=pending ---" -ForegroundColor Cyan
Write-Host "count=$($pending.data.items.Count) total=$($pending.data.total)"

# 6. search
$s = Invoke-RestMethod "$base/customers?search=monarc&limit=5" -Headers $h
Write-Host "--- GET /customers?search=monarc ---" -ForegroundColor Cyan
Write-Host "total=$($s.data.total) names=$(($s.data.items | ForEach-Object { $_.name }) -join ', ')"

# 7. send letter
$body = @{
  subject   = '{{company}} packaging - samples from {{moq}}'
  content   = '<p>Hi {{firstName}},</p><p>Testing <strong>{{company}}</strong> in {{industry}}.</p><p>Best,<br>{{senderName}}</p>'
  markAsDeveloped = $true
} | ConvertTo-Json
$sent = Invoke-RestMethod -Method Post -Uri "$base/customers/$cid/letters" -ContentType 'application/json' -Headers $h -Body $body
Show 'POST /customers/:id/letters' @{ delivered = $sent.data.delivered; channel = $sent.data.channel; message = $sent.data.message; status = $sent.data.letter.status; recipient = $sent.data.letter.recipientEmail; customerStatus = $sent.data.customer.status; letterCount = $sent.data.customer.letterCount; subject = $sent.data.letter.subject; contentHead = $sent.data.letter.content.Substring(0, [Math]::Min(140, $sent.data.letter.content.Length)) }

# 8. customer letters history
$hist = Invoke-RestMethod "$base/customers/$cid/letters?page=1&limit=10" -Headers $h
Show 'GET /customers/:id/letters' @{ total = $hist.data.total; subjects = ($hist.data.items | ForEach-Object { $_.subject }) }

# 9. letters global list
$all = Invoke-RestMethod "$base/letters?page=1&limit=5" -Headers $h
Show 'GET /letters' @{ total = $all.data.total; firstCustomer = $all.data.items[0].customer.name }

# 10. stats
$stats = Invoke-RestMethod "$base/stats/overview" -Headers $h
Show 'GET /stats/overview' @{ total = $stats.data.customer.total; pending = $stats.data.customer.pending; developed = $stats.data.customer.developed; rate = $stats.data.developmentRate; letters = $stats.data.letter.total; sent7d = $stats.data.letter.sent7d; byDay = $stats.data.letter.byDay.Count; byIndustry = $stats.data.customer.byIndustry.Count; recent = $stats.data.recentLetters.Count }

# 11. industries
$ind = Invoke-RestMethod "$base/customers/industries" -Headers $h
Show 'GET /customers/industries' $ind.data

# 12. export / template (binary)
$exp = Get-Binary "$base/customers/export" $h
Write-Host "--- GET /customers/export ---" -ForegroundColor Cyan
Write-Host "status=$($exp.StatusCode) type=$($exp.Headers['Content-Type']) bytes=$($exp.RawContentLength) disposition=$($exp.Headers['Content-Disposition'])"
$tpl = Get-Binary "$base/customers/template" $h
Write-Host "--- GET /customers/template ---" -ForegroundColor Cyan
Write-Host "status=$($tpl.StatusCode) bytes=$($tpl.RawContentLength) disposition=$($tpl.Headers['Content-Disposition'])"
$lexp = Get-Binary "$base/letters/export" $h
Write-Host "--- GET /letters/export ---" -ForegroundColor Cyan
Write-Host "status=$($lexp.StatusCode) bytes=$($lexp.RawContentLength) disposition=$($lexp.Headers['Content-Disposition'])"

# 13. bulk status + delete round trip
$new = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name='Smoke Test'; company='Smoke Ltd'; email='smoke.test@example.com'; status='pending'; source='manual' } | ConvertTo-Json)
$nid = $new.data.id
Write-Host "--- POST /customers (create) ---" -ForegroundColor Cyan
Write-Host "id=$nid name=$($new.data.name)"
$bulk = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/status" -ContentType 'application/json' -Headers $h -Body (@{ ids=@($nid); status='contacted' } | ConvertTo-Json)
Show 'POST /customers/bulk/status' $bulk.data
$del = Invoke-RestMethod -Method Delete -Uri "$base/customers/$nid" -Headers $h
Show 'DELETE /customers/:id' $del.data

# 14. import：1 条合法 + 1 条脏数据（name 为空、email 非法）
#     期望：合法行正常入库，脏数据以行级 failures 返回，而不是整批 400
$imp = @{
  customers = @(
    @{ __row = 2; name = 'Import One'; company = 'Imp Co'; email = 'import.one@example.com'; status = 'pending' },
    @{ __row = 3; name = ''; company = 'No Name'; email = 'bad' }
  )
  onDuplicate = 'skip'
  defaultStatus = 'pending'
  dryRun = $false
} | ConvertTo-Json -Depth 5
$impRes = Invoke-RestMethod -Method Post -Uri "$base/customers/import" -ContentType 'application/json' -Headers $h -Body $imp
Show 'POST /customers/import (mixed rows)' $impRes.data

# 15. import：同一邮箱再导一次，onDuplicate=update 应走更新分支
$imp2 = @{
  customers = @(@{ __row = 2; name = 'Import One Updated'; company = 'Imp Co'; email = 'import.one@example.com'; status = 'contacted' })
  onDuplicate = 'update'
  defaultStatus = 'pending'
  dryRun = $false
} | ConvertTo-Json -Depth 5
$imp2Res = Invoke-RestMethod -Method Post -Uri "$base/customers/import" -ContentType 'application/json' -Headers $h -Body $imp2
Show 'POST /customers/import (onDuplicate=update)' @{ total = $imp2Res.data.total; created = $imp2Res.data.created; updated = $imp2Res.data.updated; skipped = $imp2Res.data.skipped }

# 16. import dryRun：只预检不落库
$imp3 = @{
  customers = @(@{ __row = 2; name = 'Dry Run Only'; email = 'dry.run@example.com' })
  onDuplicate = 'skip'
  defaultStatus = 'pending'
  dryRun = $true
} | ConvertTo-Json -Depth 5
$imp3Res = Invoke-RestMethod -Method Post -Uri "$base/customers/import" -ContentType 'application/json' -Headers $h -Body $imp3
Show 'POST /customers/import (dryRun)' @{ dryRun = $imp3Res.data.dryRun; created = $imp3Res.data.created }

# 17. 更新客户（路由约定为 PUT，与前端 apiPut 一致）
$upd = Invoke-RestMethod -Method Put -Uri "$base/customers/$cid" -ContentType 'application/json' -Headers $h -Body (@{ grade = 'A'; country = 'Portugal'; website = 'https://aurumatelier.pt'; tags = @('smoke', 'verified') } | ConvertTo-Json)
Show 'PUT /customers/:id' @{ name = $upd.data.name; grade = $upd.data.grade; country = $upd.data.country; website = $upd.data.website; tags = ($upd.data.tags -join ','); status = $upd.data.status; letterCount = $upd.data.letterCount }

# 17b. 开发信预览（不落库，只渲染占位符）
#      注意：返回体是 RenderedLetter = { subject, html, text, recipientEmail, recipientName }，正文在 html 而不是 content
$prev = Invoke-RestMethod -Method Post -Uri "$base/letters/preview" -ContentType 'application/json' -Headers $h -Body (@{ customerId = $cid; subject = 'Hi {{firstName}} from {{companyName}}'; content = '<p>{{company}} / {{industry}} / {{country}} / {{customerWebsite}} / {{grade}} / MOQ {{moq}}</p>' } | ConvertTo-Json)
Show 'POST /letters/preview' @{ subject = $prev.data.subject; html = $prev.data.html; text = $prev.data.text; recipient = $prev.data.recipientEmail; recipientName = $prev.data.recipientName }

# 17b-2. 预览时客户无邮箱且未手动指定收件人，应给出可读的 400 提示
$noEmail = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name = 'No Email Person'; company = 'Phone Only Ltd'; status = 'pending' } | ConvertTo-Json)
try {
  $null = Invoke-RestMethod -Method Post -Uri "$base/letters/preview" -ContentType 'application/json' -Headers $h -Body (@{ customerId = $noEmail.data.id; subject = 'x'; content = '<p>y</p>' } | ConvertTo-Json)
} catch {
  Write-Host "--- POST /letters/preview (customer without email) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}
# 预览时手动指定收件人就应该能过
$prevOk = Invoke-RestMethod -Method Post -Uri "$base/letters/preview" -ContentType 'application/json' -Headers $h -Body (@{ customerId = $noEmail.data.id; subject = 'Hi {{firstName}}'; content = '<p>{{company}}</p>'; recipientEmail = 'manual@example.com' } | ConvertTo-Json)
Show 'POST /letters/preview (manual recipientEmail)' @{ recipient = $prevOk.data.recipientEmail; subject = $prevOk.data.subject; html = $prevOk.data.html }
$null = Invoke-RestMethod -Method Delete -Uri "$base/customers/$($noEmail.data.id)" -Headers $h

# 18. 删除开发信：letterCount 应同步递减
$lid = $hist.data.items[0].id

# 17c. 重新发送（复用原信内容，可改主题）
$resend = Invoke-RestMethod -Method Post -Uri "$base/letters/$lid/resend" -ContentType 'application/json' -Headers $h -Body (@{ subject = 'Resent: {{company}} packaging'; markAsDeveloped = $true } | ConvertTo-Json)
Show 'POST /letters/:id/resend' @{ delivered = $resend.data.delivered; channel = $resend.data.channel; status = $resend.data.letter.status; subject = $resend.data.letter.subject; customerStatus = $resend.data.customer.status; letterCount = $resend.data.customer.letterCount }

$dl = Invoke-RestMethod -Method Delete -Uri "$base/letters/$lid" -Headers $h
Show 'DELETE /letters/:id' $dl.data
$afterDel = Invoke-RestMethod "$base/customers/$cid" -Headers $h
Write-Host "--- GET /customers/:id (after letter delete) ---" -ForegroundColor Cyan
Write-Host "letterCount=$($afterDel.data.letterCount) lastContactAt=$($afterDel.data.lastContactAt)"

# 18b. 开发信批量删除（先重新发一封，再批量删）
$null = Invoke-RestMethod -Method Post -Uri "$base/customers/$cid/letters" -ContentType 'application/json' -Headers $h -Body (@{ subject = 'To be bulk deleted'; content = '<p>bye</p>'; markAsDeveloped = $false } | ConvertTo-Json)
$hist2 = Invoke-RestMethod "$base/customers/$cid/letters?limit=10" -Headers $h
$bulkDelLetters = Invoke-RestMethod -Method Post -Uri "$base/letters/bulk/delete" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($hist2.data.items | ForEach-Object { $_.id }) } | ConvertTo-Json -Depth 4)
Show 'POST /letters/bulk/delete' @{ requested = $bulkDelLetters.data.requested; deleted = $bulkDelLetters.data.deleted }
$afterBulk = Invoke-RestMethod "$base/customers/$cid" -Headers $h
Write-Host "--- GET /customers/:id (after bulk letter delete) ---" -ForegroundColor Cyan
Write-Host "letterCount=$($afterBulk.data.letterCount) lastContactAt=$($afterBulk.data.lastContactAt)"

# 19. 批量删除（先按邮箱把导入的客户查回来拿 id）
$imported = Invoke-RestMethod "$base/customers?search=import.one%40example.com&limit=5" -Headers $h
$importedIds = @($imported.data.items | ForEach-Object { $_.id })
Write-Host "--- 导入后的客户 ---" -ForegroundColor Cyan
Write-Host "total=$($imported.data.total) names=$(($imported.data.items | ForEach-Object { $_.name + '/' + $_.status }) -join ', ')"
$bulkDel = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/delete" -ContentType 'application/json' -Headers $h -Body (@{ ids = $importedIds } | ConvertTo-Json -Depth 4)
Show 'POST /customers/bulk/delete' @{ requested = $bulkDel.data.requested; deleted = $bulkDel.data.deleted; deletedLetters = $bulkDel.data.deletedLetters }

# 20. 错误体格式：未登录 401
try { Invoke-RestMethod "$base/customers" | Out-Null } catch {
  Write-Host "--- GET /customers (no token) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}

# 21. 错误体格式：非法 ObjectId 400 / 不存在 404
try { Invoke-RestMethod "$base/customers/not-an-object-id" -Headers $h | Out-Null } catch {
  Write-Host "--- GET /customers/:badId ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}
try { Invoke-RestMethod "$base/customers/000000000000000000000000" -Headers $h | Out-Null } catch {
  Write-Host "--- GET /customers/:missingId ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}

# 22. 错误体格式：登录失败 401
try {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'wrong' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- POST /auth/login (wrong password) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}

# 23. 错误体格式：校验失败 400（空内容发信）
try {
  $null = Invoke-RestMethod -Method Post -Uri "$base/customers/$cid/letters" -ContentType 'application/json' -Headers $h -Body (@{ subject = ''; content = '' } | ConvertTo-Json)
} catch {
  Write-Host "--- POST /customers/:id/letters (empty body) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}

# 24. 未登录的导出也应被拦下
try { Invoke-WebRequest "$base/customers/export" -UseBasicParsing | Out-Null } catch {
  Write-Host "--- GET /customers/export (no token) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__)"
}

# ==================================================================
# CRM upgrade regression (25-42): tags / owners vocabulary, bulk ops
# (tags add+remove, owner assign+clear, follow-up set+clear), the
# matching list filters, follow-up records, aggregated timeline and
# letter-template CRUD + duplicate.
# Everything runs against ONE throwaway customer + throwaway templates
# that are deleted at the end, so results are deterministic no matter
# what seed data exists. ASCII-only on purpose: Windows PowerShell 5.1
# reads this no-BOM file with the system ANSI code page, so non-ASCII
# literals would be corrupted.
# ==================================================================

# 25. vocabulary: reusable tags + assignable owners
$tags = Invoke-RestMethod "$base/customers/tags" -Headers $h
Write-Host "--- GET /customers/tags ---" -ForegroundColor Cyan
Write-Host "count=$($tags.data.Count) sample=$((@($tags.data) | Select-Object -First 8) -join ', ')"
$owners = Invoke-RestMethod "$base/customers/owners" -Headers $h
Show 'GET /customers/owners' @{ count = $owners.data.Count; firstName = $owners.data[0].name; firstUsername = $owners.data[0].username }
$ownerId = $owners.data[0].id

# 26. throwaway CRM customer (starts pending, no tags, no owner, no follow-up)
$crm = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name = 'CRM Smoke'; company = 'CRM Smoke Ltd'; email = 'crm.smoke@example.com'; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$crmId = $crm.data.id
Write-Host "--- POST /customers (crm throwaway) ---" -ForegroundColor Cyan
Write-Host "id=$crmId status=$($crm.data.status) tags=[$($crm.data.tags -join ',')] owner=$($crm.data.owner) nextFollowUpAt=$($crm.data.nextFollowUpAt)"

# 27. bulk add tags (validator de-dups the repeated 'vip'; $addToSet keeps it unique)
$btAdd = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/tags/add" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); tags = @('vip', 'newsletter', 'vip') } | ConvertTo-Json)
Show 'POST /customers/bulk/tags/add' @{ matched = $btAdd.data.matched; modified = $btAdd.data.modified; requested = $btAdd.data.requested; notFound = $btAdd.data.notFound }
$afterAdd = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after add tags) ---" -ForegroundColor Cyan
Write-Host "tags=[$($afterAdd.data.tags -join ', ')] count=$($afterAdd.data.tags.Count)"

# 28. filter by tag (our throwaway customer must show up under 'vip')
$byTag = Invoke-RestMethod "$base/customers?tag=vip&limit=100" -Headers $h
$tagHit = @($byTag.data.items | ForEach-Object { $_.id }) -contains $crmId
Write-Host "--- GET /customers?tag=vip ---" -ForegroundColor Cyan
Write-Host "total=$($byTag.data.total) containsCrm=$tagHit"

# 29. bulk remove tags ($pull 'newsletter', leaving 'vip')
$btRm = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/tags/remove" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); tags = @('newsletter') } | ConvertTo-Json)
Show 'POST /customers/bulk/tags/remove' @{ matched = $btRm.data.matched; modified = $btRm.data.modified }
$afterRm = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after remove tag) ---" -ForegroundColor Cyan
Write-Host "tags=[$($afterRm.data.tags -join ', ')]"

# 30. bulk assign owner
$boSet = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/owner" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); ownerId = $ownerId } | ConvertTo-Json)
Show 'POST /customers/bulk/owner (assign)' @{ matched = $boSet.data.matched; modified = $boSet.data.modified }
$afterOwner = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after assign owner) ---" -ForegroundColor Cyan
Write-Host "ownerId=$($afterOwner.data.ownerId) ownerName=$($afterOwner.data.owner.name)"

# 31. filter by owner: assigned list must contain crm, unassigned list must NOT
$byOwner = Invoke-RestMethod "$base/customers?ownerId=$ownerId&limit=100" -Headers $h
$ownerHit = @($byOwner.data.items | ForEach-Object { $_.id }) -contains $crmId
$unassigned = Invoke-RestMethod "$base/customers?ownerId=unassigned&limit=100" -Headers $h
$unassignedHit = @($unassigned.data.items | ForEach-Object { $_.id }) -contains $crmId
Write-Host "--- GET /customers?ownerId=<id> and =unassigned ---" -ForegroundColor Cyan
Write-Host "assignedTotal=$($byOwner.data.total) containsCrm=$ownerHit | unassignedTotal=$($unassigned.data.total) containsCrm(expect False)=$unassignedHit"

# 32. bulk clear owner ('' -> null)
$boClr = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/owner" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); ownerId = '' } | ConvertTo-Json)
Show 'POST /customers/bulk/owner (clear)' @{ matched = $boClr.data.matched; modified = $boClr.data.modified }
$afterClr = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after clear owner) ---" -ForegroundColor Cyan
Write-Host "owner=$($afterClr.data.owner) ownerId=$($afterClr.data.ownerId)"

# 33. bulk set next follow-up to the future + filter followUp=upcoming
$future = (Get-Date).AddDays(2).ToString('o')
$bfSet = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/follow-up" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); nextFollowUpAt = $future } | ConvertTo-Json)
Show 'POST /customers/bulk/follow-up (future)' @{ matched = $bfSet.data.matched; modified = $bfSet.data.modified }
$upcoming = Invoke-RestMethod "$base/customers?followUp=upcoming&limit=100" -Headers $h
$upHit = @($upcoming.data.items | ForEach-Object { $_.id }) -contains $crmId
Write-Host "--- GET /customers?followUp=upcoming ---" -ForegroundColor Cyan
Write-Host "total=$($upcoming.data.total) containsCrm=$upHit"

# 34. bulk set next follow-up to the past + filter followUp=overdue
$past = (Get-Date).AddDays(-2).ToString('o')
$bfPast = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/follow-up" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); nextFollowUpAt = $past } | ConvertTo-Json)
Show 'POST /customers/bulk/follow-up (past)' @{ matched = $bfPast.data.matched; modified = $bfPast.data.modified }
$overdue = Invoke-RestMethod "$base/customers?followUp=overdue&limit=100" -Headers $h
$odHit = @($overdue.data.items | ForEach-Object { $_.id }) -contains $crmId
Write-Host "--- GET /customers?followUp=overdue ---" -ForegroundColor Cyan
Write-Host "total=$($overdue.data.total) containsCrm=$odHit"

# 35. bulk clear next follow-up ('' -> null)
$bfClr = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/follow-up" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); nextFollowUpAt = '' } | ConvertTo-Json)
Show 'POST /customers/bulk/follow-up (clear)' @{ matched = $bfClr.data.matched; modified = $bfClr.data.modified }
$afterFuClr = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after clear follow-up) ---" -ForegroundColor Cyan
Write-Host "nextFollowUpAt=$($afterFuClr.data.nextFollowUpAt)"

# 36. create a follow-up record (also syncs customer.nextFollowUpAt)
$fuNext = (Get-Date).AddDays(3).ToString('o')
$fu = Invoke-RestMethod -Method Post -Uri "$base/customers/$crmId/follow-ups" -ContentType 'application/json' -Headers $h -Body (@{ method = 'phone'; content = 'Called about samples and pricing'; result = 'interested'; nextFollowUpAt = $fuNext } | ConvertTo-Json)
$fuId = $fu.data.id
Show 'POST /customers/:id/follow-ups' @{ id = $fu.data.id; method = $fu.data.method; result = $fu.data.result; followUpAt = $fu.data.followUpAt; nextFollowUpAt = $fu.data.nextFollowUpAt }
$afterFu = Invoke-RestMethod "$base/customers/$crmId" -Headers $h
Write-Host "--- GET /customers/:id (after follow-up sync) ---" -ForegroundColor Cyan
Write-Host "nextFollowUpAt=$($afterFu.data.nextFollowUpAt)"

# 37. list follow-ups (plain array, newest first)
$fuList = Invoke-RestMethod "$base/customers/$crmId/follow-ups" -Headers $h
Write-Host "--- GET /customers/:id/follow-ups ---" -ForegroundColor Cyan
Write-Host "count=$($fuList.data.Count) firstId=$($fuList.data[0].id) firstMethod=$($fuList.data[0].method) firstResult=$($fuList.data[0].result)"

# 38. timeline aggregates created + follow-up (lastContactAt from the follow-up)
$tl = Invoke-RestMethod "$base/customers/$crmId/timeline" -Headers $h
Show 'GET /customers/:id/timeline' @{ items = $tl.data.items.Count; types = (($tl.data.items | ForEach-Object { $_.type }) -join ','); lastContactAt = $tl.data.lastContactAt }

# 39. delete the follow-up record, list should drop back to zero
$fuDel = Invoke-RestMethod -Method Delete -Uri "$base/customers/$crmId/follow-ups/$fuId" -Headers $h
Show 'DELETE /customers/:id/follow-ups/:followUpId' $fuDel.data
$fuList2 = Invoke-RestMethod "$base/customers/$crmId/follow-ups" -Headers $h
Write-Host "--- GET /customers/:id/follow-ups (after delete) ---" -ForegroundColor Cyan
Write-Host "count=$($fuList2.data.Count)"

# 40. letter-template CRUD + duplicate (+ category filter)
$tpl = Invoke-RestMethod -Method Post -Uri "$base/templates" -ContentType 'application/json' -Headers $h -Body (@{ name = 'Smoke Template'; subject = 'Hi {{firstName}} from {{companyName}}'; content = '<p>Hello {{company}}, interested in {{industry}}?</p>'; category = 'first_contact' } | ConvertTo-Json)
$tplId = $tpl.data.id
Show 'POST /templates' @{ id = $tpl.data.id; name = $tpl.data.name; category = $tpl.data.category }
$tplUpd = Invoke-RestMethod -Method Put -Uri "$base/templates/$tplId" -ContentType 'application/json' -Headers $h -Body (@{ subject = 'Updated {{company}} intro'; category = 'product' } | ConvertTo-Json)
Show 'PUT /templates/:id' @{ subject = $tplUpd.data.subject; category = $tplUpd.data.category }
$tplDup = Invoke-RestMethod -Method Post -Uri "$base/templates/$tplId/duplicate" -Headers $h
$dupId = $tplDup.data.id
Show 'POST /templates/:id/duplicate' @{ id = $tplDup.data.id; name = $tplDup.data.name; distinctFromSource = ($tplDup.data.id -ne $tplId) }
$tplList = Invoke-RestMethod "$base/templates" -Headers $h
Write-Host "--- GET /templates ---" -ForegroundColor Cyan
Write-Host "count=$($tplList.data.Count) containsDup=$(@($tplList.data | ForEach-Object { $_.id }) -contains $dupId)"
$byCat = Invoke-RestMethod "$base/templates?category=product" -Headers $h
Write-Host "--- GET /templates?category=product ---" -ForegroundColor Cyan
Write-Host "count=$($byCat.data.Count)"
$dupDel = Invoke-RestMethod -Method Delete -Uri "$base/templates/$dupId" -Headers $h
$tplDel = Invoke-RestMethod -Method Delete -Uri "$base/templates/$tplId" -Headers $h
Show 'DELETE /templates/:id (duplicate + source)' @{ dupDeleted = $dupDel.data.deleted; sourceDeleted = $tplDel.data.deleted }

# 41. validation: empty tag array and malformed ownerId must be rejected
try {
  $null = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/tags/add" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); tags = @() } | ConvertTo-Json)
} catch {
  Write-Host "--- POST /customers/bulk/tags/add (empty tags) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}
try {
  $null = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/owner" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($crmId); ownerId = 'not-an-object-id' } | ConvertTo-Json)
} catch {
  Write-Host "--- POST /customers/bulk/owner (invalid ownerId) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)"
}

# 42. cleanup the throwaway customer (cascades letters / follow-ups / events)
$crmDel = Invoke-RestMethod -Method Delete -Uri "$base/customers/$crmId" -Headers $h
Show 'DELETE /customers/:id (crm throwaway)' $crmDel.data

# ==================================================================
# Data-isolation regression (43-56): strict assignment model.
# Admin creates a salesperson (role=user). The salesperson must only
# see/act on customers they own; unassigned + admin-owned customers
# are invisible; user-management and owner-roster endpoints are 403;
# creating a customer auto-assigns it to self; cross-owner read/update
# returns 404 (no existence leak). Throwaway customers are deleted at
# the end. The salesperson account has no delete endpoint yet, so it
# uses a fixed username and a 409 (already exists) is tolerated to
# keep re-runs working. ASCII-only for the same PowerShell 5.1 reason.
# ==================================================================

$salesUser = 'smoke.sales'
$salesPass = 'SmokeSales123'

# 43. admin creates a salesperson (tolerate 409 on re-run: no delete endpoint yet)
try {
  $created = Invoke-RestMethod -Method Post -Uri "$base/users" -ContentType 'application/json' -Headers $h -Body (@{ username = $salesUser; password = $salesPass; displayName = 'Smoke Sales'; role = 'user' } | ConvertTo-Json)
  Write-Host "--- POST /users (create salesperson) ---" -ForegroundColor Cyan
  Write-Host "id=$($created.data.id) username=$($created.data.username) role=$($created.data.role) displayName=$($created.data.displayName)"
} catch {
  Write-Host "--- POST /users (create salesperson) ---" -ForegroundColor Cyan
  Write-Host "status=$($_.Exception.Response.StatusCode.value__) (assume already exists) body=$($_.ErrorDetails.Message)"
}

# 44. admin lists users; resolve the salesperson id (works whether just created or pre-existing)
$users = Invoke-RestMethod "$base/users" -Headers $h
$salesId = ($users.data | Where-Object { $_.username -eq $salesUser } | Select-Object -First 1).id
Write-Host "--- GET /users ---" -ForegroundColor Cyan
Write-Host "count=$($users.data.Count) roles=$(($users.data | ForEach-Object { $_.username + '/' + $_.role }) -join ', ') salesId=$salesId"

# 45. log in as the salesperson
$slogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $salesUser; password = $salesPass } | ConvertTo-Json)
$hs = @{ Authorization = "Bearer $($slogin.data.token)" }
Write-Host "--- POST /auth/login (salesperson) ---" -ForegroundColor Cyan
Write-Host "user=$($slogin.data.user.username) role=$($slogin.data.user.role)"

# 46. salesperson sees ZERO customers at first (seed data is admin-owned or unassigned)
$sList0 = Invoke-RestMethod "$base/customers?limit=100" -Headers $hs
Write-Host "--- GET /customers (salesperson, before any assignment) ---" -ForegroundColor Cyan
Write-Host "total(expect 0)=$($sList0.data.total)"

# 47. salesperson hits admin-only endpoints -> 403
try { Invoke-RestMethod "$base/users" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /users (salesperson) ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}
try { Invoke-RestMethod "$base/customers/owners" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /customers/owners (salesperson) ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}

# 48. salesperson creates a customer -> auto-owned by self
$sNew = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $hs -Body (@{ name = 'Iso Sales Own'; company = 'Iso Sales Ltd'; email = 'iso.sales@example.com'; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$sNewId = $sNew.data.id
Write-Host "--- POST /customers (salesperson create) ---" -ForegroundColor Cyan
Write-Host "id=$sNewId ownerId(expect $salesId)=$($sNew.data.ownerId) ownerName=$($sNew.data.owner.name)"
$sList1 = Invoke-RestMethod "$base/customers?limit=100" -Headers $hs
Write-Host "--- GET /customers (salesperson, after self-create) ---" -ForegroundColor Cyan
Write-Host "total(expect 1)=$($sList1.data.total) names=$(($sList1.data.items | ForEach-Object { $_.name }) -join ', ')"

# 49. salesperson stats reflect only their own data
$sStats = Invoke-RestMethod "$base/stats/overview" -Headers $hs
Write-Host "--- GET /stats/overview (salesperson) ---" -ForegroundColor Cyan
Write-Host "customerTotal(expect 1)=$($sStats.data.customer.total)"

# 50. admin creates an unassigned customer; salesperson must NOT see it yet
$aNew = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name = 'Iso Admin Unassigned'; company = 'Iso Admin Ltd'; email = 'iso.admin@example.com'; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$aNewId = $aNew.data.id
$sList2 = Invoke-RestMethod "$base/customers?limit=100" -Headers $hs
$seesAdmin = @($sList2.data.items | ForEach-Object { $_.id }) -contains $aNewId
Write-Host "--- admin creates unassigned; salesperson visibility ---" -ForegroundColor Cyan
Write-Host "adminCustomerOwner(expect empty)=[$($aNew.data.ownerId)] salespersonSeesIt(expect False)=$seesAdmin"

# 51. salesperson 'unassigned' filter returns nothing (scope already limits to self)
$sUnassigned = Invoke-RestMethod "$base/customers?ownerId=unassigned&limit=100" -Headers $hs
Write-Host "--- GET /customers?ownerId=unassigned (salesperson) ---" -ForegroundColor Cyan
Write-Host "total(expect 0)=$($sUnassigned.data.total)"

# 52. admin assigns that customer to the salesperson -> now visible
$assign = Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/owner" -ContentType 'application/json' -Headers $h -Body (@{ ids = @($aNewId); ownerId = $salesId } | ConvertTo-Json)
$sList3 = Invoke-RestMethod "$base/customers?limit=100" -Headers $hs
$seesAssigned = @($sList3.data.items | ForEach-Object { $_.id }) -contains $aNewId
Show 'POST /customers/bulk/owner (admin assigns to salesperson)' @{ matched = $assign.data.matched; modified = $assign.data.modified }
Write-Host "--- GET /customers (salesperson, after assignment) ---" -ForegroundColor Cyan
Write-Host "total(expect 2)=$($sList3.data.total) seesAssigned(expect True)=$seesAssigned"

# 53. salesperson cannot transfer ownership (bulk/owner is admin-only) -> 403
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/bulk/owner" -ContentType 'application/json' -Headers $hs -Body (@{ ids = @($sNewId); ownerId = '' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- POST /customers/bulk/owner (salesperson) ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}

# 54. salesperson cannot read/update an admin-owned seed customer -> 404 (no existence leak)
$adminSeed = Invoke-RestMethod "$base/customers?search=monarc&limit=1" -Headers $h
$adminSeedId = $adminSeed.data.items[0].id
try { Invoke-RestMethod "$base/customers/$adminSeedId" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /customers/:adminOwnedId (salesperson) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Put -Uri "$base/customers/$adminSeedId" -ContentType 'application/json' -Headers $hs -Body (@{ grade = 'A' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT /customers/:adminOwnedId (salesperson) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 55. cleanup throwaway customers (admin can delete regardless of owner)
$c1 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$sNewId" -Headers $h
$c2 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$aNewId" -Headers $h
Show 'DELETE throwaway isolation customers' @{ salesOwnDeleted = $c1.data.id; adminUnassignedDeleted = $c2.data.id }

# 56. after cleanup the salesperson owns nothing again (keeps re-runs deterministic)
$sListEnd = Invoke-RestMethod "$base/customers?limit=100" -Headers $hs
Write-Host "--- GET /customers (salesperson, after cleanup) ---" -ForegroundColor Cyan
Write-Host "total(expect 0)=$($sListEnd.data.total)"

# ==================================================================
# Account-management regression (57-72): edit profile / reset password
# (old pw rejected, new pw works) / disable (issued token instantly 401
# + fresh login 403) / re-enable / delete (owned customer becomes
# unassigned, token 401, login 401) / self-protection (admin cannot
# disable / delete / demote self -> 403). Uses a throwaway account
# 'smoke.temp' deleted at the end, so re-runs stay clean. The
# "last active admin" guard is defensive redundancy: since the actor is
# always an admin, revoking the sole admin is already blocked by the
# self-check. ASCII-only for the same PowerShell 5.1 reason.
# ==================================================================

$tempUser = 'smoke.temp'
$tempPass = 'TempPass123'

# 57. admin creates a throwaway salesperson (tolerate 409 if a previous run left it)
try {
  $t = Invoke-RestMethod -Method Post -Uri "$base/users" -ContentType 'application/json' -Headers $h -Body (@{ username = $tempUser; password = $tempPass; displayName = 'Smoke Temp'; role = 'user' } | ConvertTo-Json)
  $tempId = $t.data.id
  Write-Host "--- POST /users (create throwaway) ---" -ForegroundColor Cyan
  Write-Host "id=$tempId status(expect active)=$($t.data.status)"
} catch {
  $us = Invoke-RestMethod "$base/users" -Headers $h
  $tempId = ($us.data | Where-Object { $_.username -eq $tempUser } | Select-Object -First 1).id
  Write-Host "--- POST /users (create throwaway) ---" -ForegroundColor Cyan
  Write-Host "already exists id=$tempId"
}

# 58. edit profile: displayName + role
$edit = Invoke-RestMethod -Method Put -Uri "$base/users/$tempId" -ContentType 'application/json' -Headers $h -Body (@{ displayName = 'Smoke Temp Renamed'; role = 'user' } | ConvertTo-Json)
Write-Host "--- PUT /users/:id (edit profile) ---" -ForegroundColor Cyan
Write-Host "displayName(expect 'Smoke Temp Renamed')=$($edit.data.displayName) role=$($edit.data.role)"

# 59. reset password: old password rejected (401), new password works
$null = Invoke-RestMethod -Method Put -Uri "$base/users/$tempId/password" -ContentType 'application/json' -Headers $h -Body (@{ password = 'NewTempPass456' } | ConvertTo-Json)
try {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $tempUser; password = $tempPass } | ConvertTo-Json) | Out-Null
  Write-Host "login with OLD pw UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- login with OLD password after reset ---" -ForegroundColor Cyan
  Write-Host "status(expect 401)=$($_.Exception.Response.StatusCode.value__)"
}
$tempPass = 'NewTempPass456'
$tlogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $tempUser; password = $tempPass } | ConvertTo-Json)
$ht = @{ Authorization = "Bearer $($tlogin.data.token)" }
Write-Host "--- login with NEW password after reset ---" -ForegroundColor Cyan
Write-Host "ok user=$($tlogin.data.user.username) role=$($tlogin.data.user.role)"

# 60. throwaway account creates a customer (auto-owned) to verify delete -> unassigned
$tNew = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $ht -Body (@{ name = 'Temp Own Customer'; company = 'Temp Ltd'; email = 'temp.own@example.com'; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$tCustId = $tNew.data.id
Write-Host "--- POST /customers (throwaway account) ---" -ForegroundColor Cyan
Write-Host "id=$tCustId ownerId(expect $tempId)=$($tNew.data.ownerId)"

# 61. self-protection: admin cannot disable / delete SELF -> 403
$adminId = ($users.data | Where-Object { $_.username -eq 'admin' } | Select-Object -First 1).id
try {
  Invoke-RestMethod -Method Put -Uri "$base/users/$adminId/status" -ContentType 'application/json' -Headers $h -Body (@{ status = 'disabled' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT /users/:adminId/status disable SELF ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Delete -Uri "$base/users/$adminId" -Headers $h | Out-Null
} catch {
  Write-Host "--- DELETE /users/:adminId SELF ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}

# 62. self-protection: admin cannot demote SELF (admin -> user) -> 403
try {
  Invoke-RestMethod -Method Put -Uri "$base/users/$adminId" -ContentType 'application/json' -Headers $h -Body (@{ role = 'user' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT /users/:adminId demote SELF ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}

# 63. disable the throwaway account
$dis = Invoke-RestMethod -Method Put -Uri "$base/users/$tempId/status" -ContentType 'application/json' -Headers $h -Body (@{ status = 'disabled' } | ConvertTo-Json)
Write-Host "--- PUT /users/:id/status disable ---" -ForegroundColor Cyan
Write-Host "status(expect disabled)=$($dis.data.status)"

# 64. disabled account: the ALREADY-ISSUED token is instantly invalid -> 401
try {
  Invoke-RestMethod "$base/customers?limit=1" -Headers $ht | Out-Null
} catch {
  Write-Host "--- GET /customers with disabled account's token ---" -ForegroundColor Cyan
  Write-Host "status(expect 401)=$($_.Exception.Response.StatusCode.value__)"
}

# 65. disabled account: a fresh login is rejected -> 403
try {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $tempUser; password = $tempPass } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- login while disabled ---" -ForegroundColor Cyan
  Write-Host "status(expect 403)=$($_.Exception.Response.StatusCode.value__)"
}

# 66. re-enable -> login works again
$en = Invoke-RestMethod -Method Put -Uri "$base/users/$tempId/status" -ContentType 'application/json' -Headers $h -Body (@{ status = 'active' } | ConvertTo-Json)
$tlogin2 = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $tempUser; password = $tempPass } | ConvertTo-Json)
$ht2 = @{ Authorization = "Bearer $($tlogin2.data.token)" }
Write-Host "--- PUT /users/:id/status re-enable + login ---" -ForegroundColor Cyan
Write-Host "status(expect active)=$($en.data.status) loginOk=$([bool]$tlogin2.data.token)"

# 67. delete the throwaway account -> its owned customer becomes unassigned
$del = Invoke-RestMethod -Method Delete -Uri "$base/users/$tempId" -Headers $h
Write-Host "--- DELETE /users/:id ---" -ForegroundColor Cyan
Write-Host "reassignedCustomers(expect 1)=$($del.data.reassignedCustomers)"

# 68. the customer still exists but is now unassigned (admin still sees it)
$afterCust = Invoke-RestMethod "$base/customers/$tCustId" -Headers $h
Write-Host "--- GET /customers/:id after owner deleted ---" -ForegroundColor Cyan
Write-Host "name=$($afterCust.data.name) ownerId(expect empty)=[$($afterCust.data.ownerId)]"

# 69. deleted account: its token is now invalid -> 401
try {
  Invoke-RestMethod "$base/customers?limit=1" -Headers $ht2 | Out-Null
} catch {
  Write-Host "--- GET /customers with deleted account's token ---" -ForegroundColor Cyan
  Write-Host "status(expect 401)=$($_.Exception.Response.StatusCode.value__)"
}

# 70. deleted account: login rejected -> 401 (unified 'bad credentials')
try {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = $tempUser; password = $tempPass } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- login after account deleted ---" -ForegroundColor Cyan
  Write-Host "status(expect 401)=$($_.Exception.Response.StatusCode.value__)"
}

# 71. cleanup the now-unassigned throwaway customer
$null = Invoke-RestMethod -Method Delete -Uri "$base/customers/$tCustId" -Headers $h
Write-Host "--- DELETE throwaway customer ---" -ForegroundColor Cyan
Write-Host "id=$tCustId"

# 72. GET /users no longer lists the deleted throwaway account
$usersEnd = Invoke-RestMethod "$base/users" -Headers $h
$tempGone = -not ($usersEnd.data | Where-Object { $_.username -eq $tempUser })
Write-Host "--- GET /users after deletion ---" -ForegroundColor Cyan
Write-Host "count=$($usersEnd.data.Count) tempGone(expect True)=$tempGone"

# ==================================================================
# CRM basic-features regression (73-93): follow-up EDIT, normalized
# leadSource, customer requirement + contact fields, priority (with a
# 'medium' default), attachments (base64 upload / auth download /
# delete) and the matching list filters + Excel import/export of the
# new columns. Everything runs against throwaway customers deleted at
# the end, and reuses the salesperson token ($hs) for cross-owner 404
# isolation checks. ASCII-only for the same PowerShell 5.1 reason:
# non-ASCII literals would be corrupted by the system ANSI code page.
# ==================================================================

# 73. create a feature-rich throwaway customer (admin): leadSource + priority + contact channels + requirements
$fx = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{
  name = 'Feature Smoke'; company = 'Feature Ltd'; email = 'feature.smoke@example.com'; status = 'pending'; source = 'manual';
  leadSource = 'Alibaba'; priority = 'high';
  whatsapp = '+8613800138000'; skype = 'feature.skype'; linkedin = 'https://linkedin.com/in/feature'; facebook = 'feature.fb'; instagram = 'https://instagram.com/feature';
  interestedProducts = 'Solar Panel, LED Light'; productModel = 'SP-300'; productCategory = 'Renewable'; expectedQuantity = '5000 pcs'; targetPrice = 'USD 12/pc'; moq = '1000'; requirementNotes = 'Need CE cert and OEM packaging'
} | ConvertTo-Json)
$fxId = $fx.data.id
Show 'POST /customers (feature-rich: leadSource/priority/contact/requirements)' @{ id = $fxId; leadSource = $fx.data.leadSource; priority = $fx.data.priority; whatsapp = $fx.data.whatsapp; skype = $fx.data.skype; linkedin = $fx.data.linkedin; facebook = $fx.data.facebook; instagram = $fx.data.instagram; interestedProducts = $fx.data.interestedProducts; productModel = $fx.data.productModel; productCategory = $fx.data.productCategory; expectedQuantity = $fx.data.expectedQuantity; targetPrice = $fx.data.targetPrice; moq = $fx.data.moq; requirementNotes = $fx.data.requirementNotes }

# 74. priority defaults to 'medium' when omitted (new-customer default + old-data compatibility)
$fxDef = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name = 'Priority Default'; company = 'Default Ltd'; email = 'priority.default@example.com'; status = 'pending' } | ConvertTo-Json)
$fxDefId = $fxDef.data.id
Write-Host "--- POST /customers (priority omitted) ---" -ForegroundColor Cyan
Write-Host "priority(expect medium)=$($fxDef.data.priority)"

# 75. edit requirements + downgrade priority (PUT); untouched contact fields must persist
$fxUpd = Invoke-RestMethod -Method Put -Uri "$base/customers/$fxId" -ContentType 'application/json' -Headers $h -Body (@{ priority = 'low'; interestedProducts = 'Inverter'; targetPrice = 'USD 9/pc'; requirementNotes = 'Updated: also need datasheet' } | ConvertTo-Json)
Show 'PUT /customers/:id (requirements + priority)' @{ priority = $fxUpd.data.priority; interestedProducts = $fxUpd.data.interestedProducts; targetPrice = $fxUpd.data.targetPrice; requirementNotes = $fxUpd.data.requirementNotes; whatsappKept = $fxUpd.data.whatsapp; linkedinKept = $fxUpd.data.linkedin }

# 76. leadSource filter: our 'Alibaba' customer must be found
$bySrc = Invoke-RestMethod "$base/customers?leadSource=Alibaba&limit=100" -Headers $h
$srcHit = @($bySrc.data.items | ForEach-Object { $_.id }) -contains $fxId
Write-Host "--- GET /customers?leadSource=Alibaba ---" -ForegroundColor Cyan
Write-Host "total=$($bySrc.data.total) containsFx(expect True)=$srcHit"

# 77. priority filter: after downgrade fx is under 'low', not 'high'
$byLow = Invoke-RestMethod "$base/customers?priority=low&limit=100" -Headers $h
$byHigh = Invoke-RestMethod "$base/customers?priority=high&limit=100" -Headers $h
$lowHit = @($byLow.data.items | ForEach-Object { $_.id }) -contains $fxId
$highHit = @($byHigh.data.items | ForEach-Object { $_.id }) -contains $fxId
Write-Host "--- GET /customers?priority=low and =high ---" -ForegroundColor Cyan
Write-Host "lowContainsFx(expect True)=$lowHit highContainsFx(expect False)=$highHit"

# 78. create a follow-up on fx (syncs customer.nextFollowUpAt)
$fxFuNext = (Get-Date).AddDays(5).ToString('o')
$fxFu = Invoke-RestMethod -Method Post -Uri "$base/customers/$fxId/follow-ups" -ContentType 'application/json' -Headers $h -Body (@{ method = 'email'; content = 'Sent catalog and price list'; result = 'quoted'; nextFollowUpAt = $fxFuNext } | ConvertTo-Json)
$fxFuId = $fxFu.data.id
Show 'POST /customers/:id/follow-ups (fx)' @{ id = $fxFuId; method = $fxFu.data.method; result = $fxFu.data.result; nextFollowUpAt = $fxFu.data.nextFollowUpAt }

# 79. EDIT the follow-up (PUT): change method/result/content + nextFollowUpAt; verify customer sync
$fxFuNext2 = (Get-Date).AddDays(9).ToString('o')
$fxFuUpd = Invoke-RestMethod -Method Put -Uri "$base/customers/$fxId/follow-ups/$fxFuId" -ContentType 'application/json' -Headers $h -Body (@{ method = 'whatsapp'; content = 'Followed up on WhatsApp, awaiting reply'; result = 'negotiating'; nextFollowUpAt = $fxFuNext2 } | ConvertTo-Json)
Show 'PUT /customers/:id/follow-ups/:followUpId (edit)' @{ id = $fxFuUpd.data.id; method = $fxFuUpd.data.method; result = $fxFuUpd.data.result; nextFollowUpAt = $fxFuUpd.data.nextFollowUpAt }
$afterFxEdit = Invoke-RestMethod "$base/customers/$fxId" -Headers $h
Write-Host "--- GET /customers/:id (after follow-up edit sync) ---" -ForegroundColor Cyan
Write-Host "nextFollowUpAt(expect the +9d value)=$($afterFxEdit.data.nextFollowUpAt)"

# 80. list follow-ups: the edit must be reflected (newest first)
$fxFuList = Invoke-RestMethod "$base/customers/$fxId/follow-ups" -Headers $h
Write-Host "--- GET /customers/:id/follow-ups (after edit) ---" -ForegroundColor Cyan
Write-Host "count=$($fxFuList.data.Count) firstMethod(expect whatsapp)=$($fxFuList.data[0].method) firstResult(expect negotiating)=$($fxFuList.data[0].result)"

# 81. isolation: salesperson cannot create/edit follow-ups on an admin-owned customer -> 404
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$fxId/follow-ups" -ContentType 'application/json' -Headers $hs -Body (@{ method = 'phone'; content = 'should not work'; result = 'other' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- POST /customers/:id/follow-ups (salesperson, admin-owned) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Put -Uri "$base/customers/$fxId/follow-ups/$fxFuId" -ContentType 'application/json' -Headers $hs -Body (@{ content = 'hijack' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT /customers/:id/follow-ups/:followUpId (salesperson, admin-owned) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 82. delete the follow-up
$fxFuDel = Invoke-RestMethod -Method Delete -Uri "$base/customers/$fxId/follow-ups/$fxFuId" -Headers $h
Show 'DELETE /customers/:id/follow-ups/:followUpId (fx)' $fxFuDel.data

# 83. upload an attachment (base64 JSON, reuses the express.json channel; no multipart)
$attText = 'hello attachment from smoke test'
$attB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($attText))
$fxAtt = Invoke-RestMethod -Method Post -Uri "$base/customers/$fxId/attachments" -ContentType 'application/json' -Headers $h -Body (@{ originalName = 'smoke-note.txt'; mimeType = 'text/plain'; dataBase64 = $attB64 } | ConvertTo-Json)
$fxAttId = $fxAtt.data.id
Show 'POST /customers/:id/attachments (upload base64)' @{ id = $fxAttId; originalName = $fxAtt.data.originalName; mimeType = $fxAtt.data.mimeType; size = $fxAtt.data.size }

# 84. list attachments
$fxAttList = Invoke-RestMethod "$base/customers/$fxId/attachments" -Headers $h
Write-Host "--- GET /customers/:id/attachments ---" -ForegroundColor Cyan
Write-Host "count(expect 1)=$($fxAttList.data.Count) firstName=$($fxAttList.data[0].originalName) firstSize=$($fxAttList.data[0].size)"

# 85. download the attachment (binary) through the auth-only endpoint and verify the round-trip
$dl = Get-Binary "$base/customers/$fxId/attachments/$fxAttId/download" $h
$dlText = if ($dl.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($dl.Content) } else { [string]$dl.Content }
Write-Host "--- GET /customers/:id/attachments/:attachmentId/download ---" -ForegroundColor Cyan
Write-Host "status=$($dl.StatusCode) type=$($dl.Headers['Content-Type']) bytes=$($dl.RawContentLength) contentMatches(expect True)=$($dlText -eq $attText)"

# 86. isolation: salesperson cannot list/download/upload attachments on an admin-owned customer -> 404
try { Invoke-RestMethod "$base/customers/$fxId/attachments" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /customers/:id/attachments (salesperson, admin-owned) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try { Get-Binary "$base/customers/$fxId/attachments/$fxAttId/download" $hs | Out-Null } catch {
  Write-Host "--- GET attachment download (salesperson, admin-owned) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$fxId/attachments" -ContentType 'application/json' -Headers $hs -Body (@{ originalName = 'x.txt'; dataBase64 = $attB64 } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- POST attachment upload (salesperson, admin-owned) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 87. delete the attachment; list drops back to zero
$fxAttDel = Invoke-RestMethod -Method Delete -Uri "$base/customers/$fxId/attachments/$fxAttId" -Headers $h
Show 'DELETE /customers/:id/attachments/:attachmentId' $fxAttDel.data
$fxAttList2 = Invoke-RestMethod "$base/customers/$fxId/attachments" -Headers $h
Write-Host "--- GET /customers/:id/attachments (after delete) ---" -ForegroundColor Cyan
Write-Host "count(expect 0)=$($fxAttList2.data.Count)"

# 88. download an already-deleted attachment -> 404
try { Get-Binary "$base/customers/$fxId/attachments/$fxAttId/download" $h | Out-Null } catch {
  Write-Host "--- GET attachment download (already deleted) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 89. Excel import (JSON rows, same shape the front-end posts): new columns + custom leadSource + priority normalization
$impFx = @{
  customers = @(
    @{ __row = 2; name = 'Import Feature A'; company = 'Imp Feat A'; email = 'import.feature.a@example.com'; status = 'pending'; leadSource = 'Dubai Exhibition'; priority = 'High'; whatsapp = '+971501234567'; linkedin = 'https://linkedin.com/in/ifa'; interestedProducts = 'LED Light'; moq = '500' },
    @{ __row = 3; name = 'Import Feature B'; company = 'Imp Feat B'; email = 'import.feature.b@example.com'; status = 'pending'; leadSource = 'Made-in-China'; priority = 'l'; interestedProducts = 'Inverter' }
  )
  onDuplicate = 'skip'
  defaultStatus = 'pending'
  dryRun = $false
} | ConvertTo-Json -Depth 5
$impFxRes = Invoke-RestMethod -Method Post -Uri "$base/customers/import" -ContentType 'application/json' -Headers $h -Body $impFx
Show 'POST /customers/import (new columns)' @{ total = $impFxRes.data.total; created = $impFxRes.data.created; updated = $impFxRes.data.updated; skipped = $impFxRes.data.skipped }

# 90. verify imported fields persisted (custom leadSource kept as-is; priority normalized High->high, l->low)
$impA = Invoke-RestMethod "$base/customers?search=import.feature.a%40example.com&limit=1" -Headers $h
$impAId = $impA.data.items[0].id
Show 'GET imported Feature A' @{ leadSource = $impA.data.items[0].leadSource; priority = $impA.data.items[0].priority; whatsapp = $impA.data.items[0].whatsapp; linkedin = $impA.data.items[0].linkedin; interestedProducts = $impA.data.items[0].interestedProducts; moq = $impA.data.items[0].moq }
$impB = Invoke-RestMethod "$base/customers?search=import.feature.b%40example.com&limit=1" -Headers $h
$impBId = $impB.data.items[0].id
Show 'GET imported Feature B' @{ leadSource = $impB.data.items[0].leadSource; priority = $impB.data.items[0].priority; interestedProducts = $impB.data.items[0].interestedProducts }

# 91. Excel export still succeeds with the new columns; peek the xlsx XML for ASCII header/value tokens
$expFx = Get-Binary "$base/customers/export" $h
Write-Host "--- GET /customers/export (with new columns) ---" -ForegroundColor Cyan
Write-Host "status=$($expFx.StatusCode) type=$($expFx.Headers['Content-Type']) bytes=$($expFx.RawContentLength)"
try {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $ms = New-Object System.IO.MemoryStream(,$expFx.Content)
  $zip = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Read)
  $allXml = ''
  foreach ($e in $zip.Entries) {
    if ($e.FullName -like '*.xml') {
      $sr = New-Object System.IO.StreamReader($e.Open())
      $allXml += $sr.ReadToEnd()
      $sr.Close()
    }
  }
  $zip.Dispose(); $ms.Dispose()
  $tokens = @('WhatsApp', 'LinkedIn', 'Instagram', 'MOQ', 'Dubai Exhibition', 'Made-in-China', 'Inverter')
  $found = @($tokens | Where-Object { $allXml -like "*$_*" })
  Write-Host "exportTokensFound(expect all 7)=[$($found -join ', ')]"
} catch {
  Write-Host "exportTokensPeek=skipped ($($_.Exception.Message))"
}

# 92. cleanup throwaway feature customers (cascades follow-ups / attachments / letters / events)
$fd1 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$fxId" -Headers $h
$fd2 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$fxDefId" -Headers $h
$fd3 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$impAId" -Headers $h
$fd4 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$impBId" -Headers $h
Show 'DELETE throwaway feature customers' @{ feature = $fd1.data.id; priorityDefault = $fd2.data.id; importA = $fd3.data.id; importB = $fd4.data.id }

# 93. a deleted customer is gone (404), confirming cleanup for deterministic re-runs
try { Invoke-RestMethod "$base/customers/$fxId" -Headers $h | Out-Null } catch {
  Write-Host "--- GET /customers/:id (after cleanup) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# ==================================================================
# Quotation-management regression (94-112): V2 feature. Covers create
# (auto + custom number), per-line and total amount computed by the
# backend (client-sent amounts are stripped and recomputed), read /
# list / filter, edit, status update with and without the explicit
# customer "quoting" linkage, timeline derivation, invalid customerId
# (422 / 404), invalid payloads (422), salesperson isolation (404 on
# all 7 routes, no existence leak), the salesperson happy path plus
# admin read-all, delete, and cascade cleanup. Uses throwaway customers
# deleted at the end so re-runs stay deterministic. ASCII-only for the
# same PowerShell 5.1 reason.
# ==================================================================

$qts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$qCustomNo = "QT-SMOKE-$qts"
$qCustomNoLower = "qt-smoke-$qts"

# 94. admin creates a throwaway customer to own the quotations
$qc = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $h -Body (@{ name = 'Quote Smoke Co'; company = 'Quote Smoke Ltd'; email = "quote.smoke.$qts@example.com"; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$qcId = $qc.data.id
Write-Host "--- POST /customers (quotation throwaway) ---" -ForegroundColor Cyan
Write-Host "id=$qcId status(expect pending)=$($qc.data.status)"

# 95. create with auto number + 2 items; backend computes each line amount and the total
$q1Body = @{ title = 'Smoke Quote Auto'; currency = 'USD'; validityDate = '2026-12-31'; items = @( @{ productName = 'Steel Ring'; model = 'SR-01'; quantity = 10; unitPrice = 2.5 }, @{ productName = 'Gold Ring'; model = 'GR-02'; quantity = 3; unitPrice = 100 } ) } | ConvertTo-Json -Depth 6
$q1 = Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body $q1Body
$q1Id = $q1.data.id
$q1No = $q1.data.quotationNo
$q1NoOk = $q1No -match '^QT-\d{8}-\d{3}$'
Write-Host "--- POST /customers/:id/quotations (auto number, 2 items, validity set) ---" -ForegroundColor Cyan
Write-Host "no=$q1No numberPatternOk(expect True)=$q1NoOk line0(expect 25)=$($q1.data.items[0].amount) line1(expect 300)=$($q1.data.items[1].amount) total(expect 325)=$($q1.data.totalAmount) status(expect draft)=$($q1.data.status) validityOk(expect True)=$($q1.data.validityDate -like '2026-12-31*')"

# 96. read the single quotation back via the nested detail route
$q1Get = Invoke-RestMethod "$base/customers/$qcId/quotations/$q1Id" -Headers $h
Show 'GET /customers/:id/quotations/:quotationId' @{ quotationNo = $q1Get.data.quotationNo; total = $q1Get.data.totalAmount; itemCount = $q1Get.data.items.Count }

# 97. list the customer's quotations (array shape, newest first)
$qList = Invoke-RestMethod "$base/customers/$qcId/quotations" -Headers $h
Write-Host "--- GET /customers/:id/quotations ---" -ForegroundColor Cyan
Write-Host "count(expect 1)=$($qList.data.Count) firstNo=$($qList.data[0].quotationNo)"

# 98. create with a custom lowercase number; backend stores it upper-cased
$q2Body = @{ quotationNo = $qCustomNoLower; title = 'Smoke Quote Custom'; currency = 'EUR'; validityDate = $null; items = @( @{ productName = 'Silver Ring'; quantity = 5; unitPrice = 4 }, @{ productName = 'Bronze Ring'; quantity = 2; unitPrice = 1.5 } ) } | ConvertTo-Json -Depth 6
$q2 = Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body $q2Body
$q2Id = $q2.data.id
Write-Host "--- POST /customers/:id/quotations (custom number, EUR, null validity) ---" -ForegroundColor Cyan
Write-Host "storedNo(expect $qCustomNo)=$($q2.data.quotationNo) upperOk(expect True)=$($q2.data.quotationNo -ceq $qCustomNo) total(expect 23)=$($q2.data.totalAmount) currency(expect EUR)=$($q2.data.currency) validityUnset(expect True)=$([string]::IsNullOrEmpty($q2.data.validityDate))"

# 99. duplicate custom number -> 409
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body (@{ quotationNo = $qCustomNo; title = 'Dup'; items = @( @{ productName = 'X'; quantity = 1; unitPrice = 1 } ) } | ConvertTo-Json -Depth 6) | Out-Null
  Write-Host "duplicate number UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- POST duplicate quotationNo ---" -ForegroundColor Cyan
  Write-Host "status(expect 409)=$($_.Exception.Response.StatusCode.value__)"
}

# 100. edit and tamper the line amounts; backend recomputes and ignores the tampering
$qEditBody = @{ title = 'Smoke Quote Custom v2'; items = @( @{ productName = 'Silver Ring'; quantity = 5; unitPrice = 4; amount = 999999 }, @{ productName = 'Bronze Ring'; quantity = 2; unitPrice = 1.5; amount = 888888 } ) } | ConvertTo-Json -Depth 6
$qEdit = Invoke-RestMethod -Method Put -Uri "$base/customers/$qcId/quotations/$q2Id" -ContentType 'application/json' -Headers $h -Body $qEditBody
Write-Host "--- PUT /customers/:id/quotations/:quotationId (tampered amounts) ---" -ForegroundColor Cyan
Write-Host "title=$($qEdit.data.title) line0(expect 20)=$($qEdit.data.items[0].amount) line1(expect 3)=$($qEdit.data.items[1].amount) total(expect 23)=$($qEdit.data.totalAmount) tamperIgnored(expect True)=$($qEdit.data.totalAmount -eq 23 -and $qEdit.data.items[0].amount -eq 20)"

# 101. status -> 'sent' WITHOUT linkage; customer sales status stays 'pending'
$qS1 = Invoke-RestMethod -Method Put -Uri "$base/customers/$qcId/quotations/$q1Id/status" -ContentType 'application/json' -Headers $h -Body (@{ status = 'sent' } | ConvertTo-Json)
$cAfterSent = Invoke-RestMethod "$base/customers/$qcId" -Headers $h
Write-Host "--- PUT .../status (sent, no linkage) ---" -ForegroundColor Cyan
Write-Host "quotationStatus(expect sent)=$($qS1.data.status) customerStatus(expect pending)=$($cAfterSent.data.status)"

# 102. status -> 'negotiating' WITH explicit linkage; customer advances pending -> quoting
$qS2 = Invoke-RestMethod -Method Put -Uri "$base/customers/$qcId/quotations/$q1Id/status" -ContentType 'application/json' -Headers $h -Body (@{ status = 'negotiating'; markCustomerAsQuoting = $true } | ConvertTo-Json)
$cAfterLink = Invoke-RestMethod "$base/customers/$qcId" -Headers $h
Write-Host "--- PUT .../status (negotiating + markCustomerAsQuoting) ---" -ForegroundColor Cyan
Write-Host "quotationStatus(expect negotiating)=$($qS2.data.status) customerStatus(expect quoting)=$($cAfterLink.data.status)"

# 103. top-level list with filters (by customer, by status); customer summary is populated
$qByCustomer = Invoke-RestMethod "$base/quotations?customerId=$qcId&limit=50" -Headers $h
$qByStatus = Invoke-RestMethod "$base/quotations?customerId=$qcId&status=negotiating&limit=50" -Headers $h
Write-Host "--- GET /quotations (filters) ---" -ForegroundColor Cyan
Write-Host "byCustomerTotal(expect 2)=$($qByCustomer.data.total) byStatusNegotiating(expect 1)=$($qByStatus.data.total) customerName=$($qByCustomer.data.items[0].customer.name)"

# 104. timeline derives quotation events (+ the status_changed event from the linkage)
$qTl = Invoke-RestMethod "$base/customers/$qcId/timeline" -Headers $h
$qTlTypes = ($qTl.data.items | ForEach-Object { $_.type })
$qQuoteEvents = @($qTlTypes | Where-Object { $_ -eq 'quotation' }).Count
$qStatusEvents = @($qTlTypes | Where-Object { $_ -eq 'status_changed' }).Count
Write-Host "--- GET /customers/:id/timeline (quotation derivation) ---" -ForegroundColor Cyan
Write-Host "quotationEvents(expect 2)=$qQuoteEvents statusChangedEvents(expect 1)=$qStatusEvents types=$(($qTlTypes) -join ',')"

# 105. invalid customerId: malformed ObjectId -> 422 (validate middleware); well-formed but missing -> 404
try { Invoke-RestMethod "$base/customers/not-an-id/quotations" -Headers $h | Out-Null } catch {
  Write-Host "--- GET /customers/:badId/quotations ---" -ForegroundColor Cyan
  Write-Host "status(expect 422)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Post -Uri "$base/quotations" -ContentType 'application/json' -Headers $h -Body (@{ customerId = '000000000000000000000000'; title = 'Ghost'; items = @( @{ productName = 'X'; quantity = 1; unitPrice = 1 } ) } | ConvertTo-Json -Depth 6) | Out-Null
  Write-Host "missing-customer create UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- POST /quotations (missing customer) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 106. invalid payloads -> 422 (validate middleware: empty items, missing title, non-positive quantity)
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body (@{ title = 'No Items'; items = @() } | ConvertTo-Json -Depth 6) | Out-Null
  Write-Host "empty-items UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- POST quotation (empty items) ---" -ForegroundColor Cyan
  Write-Host "status(expect 422)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body (@{ items = @( @{ productName = 'X'; quantity = 1; unitPrice = 1 } ) } | ConvertTo-Json -Depth 6) | Out-Null
  Write-Host "missing-title UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- POST quotation (missing title) ---" -ForegroundColor Cyan
  Write-Host "status(expect 422)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $h -Body (@{ title = 'Bad Qty'; items = @( @{ productName = 'X'; quantity = 0; unitPrice = 1 } ) } | ConvertTo-Json -Depth 6) | Out-Null
  Write-Host "quantity-zero UNEXPECTEDLY succeeded"
} catch {
  Write-Host "--- POST quotation (quantity=0) ---" -ForegroundColor Cyan
  Write-Host "status(expect 422)=$($_.Exception.Response.StatusCode.value__)"
}

# 107. salesperson isolation: all 7 quotation routes on an admin-owned customer -> 404 (no leak)
try { Invoke-RestMethod "$base/customers/$qcId/quotations" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /customers/:id/quotations (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Post -Uri "$base/customers/$qcId/quotations" -ContentType 'application/json' -Headers $hs -Body (@{ title = 'Sneak'; items = @( @{ productName = 'X'; quantity = 1; unitPrice = 1 } ) } | ConvertTo-Json -Depth 6) | Out-Null
} catch {
  Write-Host "--- POST /customers/:id/quotations (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try { Invoke-RestMethod "$base/customers/$qcId/quotations/$q1Id" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET nested quotation detail (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Put -Uri "$base/customers/$qcId/quotations/$q1Id" -ContentType 'application/json' -Headers $hs -Body (@{ title = 'Hijack' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT nested quotation (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try {
  Invoke-RestMethod -Method Put -Uri "$base/customers/$qcId/quotations/$q1Id/status" -ContentType 'application/json' -Headers $hs -Body (@{ status = 'accepted' } | ConvertTo-Json) | Out-Null
} catch {
  Write-Host "--- PUT nested quotation status (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try { Invoke-RestMethod -Method Delete -Uri "$base/customers/$qcId/quotations/$q1Id" -Headers $hs | Out-Null } catch {
  Write-Host "--- DELETE nested quotation (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}
try { Invoke-RestMethod "$base/quotations/$q1Id" -Headers $hs | Out-Null } catch {
  Write-Host "--- GET /quotations/:id (salesperson, other owner) ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 108. salesperson happy path: own customer + quotation; admin can also read it (sees all)
$qtCust = Invoke-RestMethod -Method Post -Uri "$base/customers" -ContentType 'application/json' -Headers $hs -Body (@{ name = 'Sales Quote Co'; company = 'Sales Quote Ltd'; email = "sales.quote.$qts@example.com"; status = 'pending'; source = 'manual' } | ConvertTo-Json)
$qtCustId = $qtCust.data.id
$qtQuote = Invoke-RestMethod -Method Post -Uri "$base/customers/$qtCustId/quotations" -ContentType 'application/json' -Headers $hs -Body (@{ title = 'Sales Own Quote'; currency = 'USD'; items = @( @{ productName = 'Widget'; quantity = 3; unitPrice = 5 } ) } | ConvertTo-Json -Depth 6)
$qtQuoteId = $qtQuote.data.id
$qtList = Invoke-RestMethod "$base/customers/$qtCustId/quotations" -Headers $hs
$qtAdminRead = Invoke-RestMethod "$base/quotations/$qtQuoteId" -Headers $h
Write-Host "--- salesperson creates own customer + quotation ---" -ForegroundColor Cyan
Write-Host "ownerId(expect $salesId)=$($qtCust.data.ownerId) listCount(expect 1)=$($qtList.data.Count) total(expect 15)=$($qtQuote.data.totalAmount) adminCanRead(expect True)=$($qtAdminRead.data.id -eq $qtQuoteId)"

# 109. delete a quotation; the customer's list drops back to one
$qDel = Invoke-RestMethod -Method Delete -Uri "$base/customers/$qcId/quotations/$q2Id" -Headers $h
$qAfterDel = Invoke-RestMethod "$base/customers/$qcId/quotations" -Headers $h
Show 'DELETE /customers/:id/quotations/:quotationId' @{ deleted = $qDel.data.deleted; id = $qDel.data.id }
Write-Host "--- GET /customers/:id/quotations (after delete) ---" -ForegroundColor Cyan
Write-Host "count(expect 1)=$($qAfterDel.data.Count)"

# 110. the deleted quotation is gone (404)
try { Invoke-RestMethod "$base/customers/$qcId/quotations/$q2Id" -Headers $h | Out-Null } catch {
  Write-Host "--- GET deleted quotation ---" -ForegroundColor Cyan
  Write-Host "status(expect 404)=$($_.Exception.Response.StatusCode.value__)"
}

# 111. cleanup throwaway customers (cascades their quotations)
$qcd1 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$qcId" -Headers $h
$qcd2 = Invoke-RestMethod -Method Delete -Uri "$base/customers/$qtCustId" -Headers $h
Show 'DELETE throwaway quotation customers' @{ adminQuoteCustomer = $qcd1.data.id; salesQuoteCustomer = $qcd2.data.id }

# 112. cascade confirmed: both customers' quotations are gone
$qc1Gone = Invoke-RestMethod "$base/quotations?customerId=$qcId&limit=50" -Headers $h
$qc2Gone = Invoke-RestMethod "$base/quotations?customerId=$qtCustId&limit=50" -Headers $h
Write-Host "--- GET /quotations?customerId= (after cascade delete) ---" -ForegroundColor Cyan
Write-Host "adminCustomerQuotations(expect 0)=$($qc1Gone.data.total) salesCustomerQuotations(expect 0)=$($qc2Gone.data.total)"

Write-Host "`nALL SMOKE TESTS DONE" -ForegroundColor Green
