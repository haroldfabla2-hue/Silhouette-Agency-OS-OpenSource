$headers = @{
    "Authorization" = "Bearer sk-silhouette-admin"
    "Content-Type" = "application/json"
}

Write-Host "Querying Continuum Memory State..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/v1/memory/state" -Method Get -Headers $headers
    
    Write-Host "Success!" -ForegroundColor Green
    Write-Host "--------------------------------"
    
    # Display Stats
    Write-Host "Nodes Breakdown:" -ForegroundColor Yellow
    $response.nodes | Get-Member -MemberType NoteProperty | ForEach-Object {
        $tier = $_.Name
        $count = $response.nodes.$tier.Count
        Write-Host "  $tier : $count"
    }

    Write-Host "`nStats Object:" -ForegroundColor Yellow
    $response.stats | Format-List

    # Option to dump full JSON
    # $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error querying memory endpoint: $_" -ForegroundColor Red
}
