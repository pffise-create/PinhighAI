# AWS Golf Coach Architecture Inventory Script
# Run this in PowerShell to export your complete AWS setup

$region = "us-east-1"
$outputDir = "aws-architecture"

# Create output directory
New-Item -ItemType Directory -Force -Path $outputDir

Write-Host "🔍 Exporting AWS Golf Coach Architecture..." -ForegroundColor Green

# 1. Lambda Functions
Write-Host "📦 Exporting Lambda Functions..." -ForegroundColor Yellow
aws lambda list-functions --region $region --query 'Functions[?contains(FunctionName, `golf`)]' > "$outputDir/lambda-functions.json"

# Get detailed configs for each golf-related Lambda
$lambdaFunctions = @("golf-ai-analysis", "golf-coach-frame-extractor-container", "golf-presigned-url-generator", "golf-coach-frame-extractor")
foreach ($func in $lambdaFunctions) {
    Write-Host "  🔧 Getting config for $func"
    aws lambda get-function-configuration --function-name $func --region $region > "$outputDir/lambda-$func-config.json" 2>$null
    aws lambda get-function --function-name $func --region $region > "$outputDir/lambda-$func-full.json" 2>$null
}

# 2. API Gateway
Write-Host "🌐 Exporting API Gateway..." -ForegroundColor Yellow
aws apigateway get-rest-api --rest-api-id t7y64hqkq0 --region $region > "$outputDir/api-gateway-info.json" 2>$null
aws apigateway get-resources --rest-api-id t7y64hqkq0 --region $region > "$outputDir/api-gateway-resources.json" 2>$null
aws apigateway get-stages --rest-api-id t7y64hqkq0 --region $region > "$outputDir/api-gateway-stages.json" 2>$null

# Get method details for each resource
$resources = aws apigateway get-resources --rest-api-id t7y64hqkq0 --region $region --query 'items[].id' --output text 2>$null
if ($resources) {
    $resourceIds = $resources -split "`t"
    foreach ($resourceId in $resourceIds) {
        aws apigateway get-resource --rest-api-id t7y64hqkq0 --resource-id $resourceId --region $region > "$outputDir/api-resource-$resourceId.json" 2>$null
    }
}

# 3. DynamoDB
Write-Host "🗃️ Exporting DynamoDB..." -ForegroundColor Yellow
aws dynamodb describe-table --table-name golf-coach-analyses --region $region > "$outputDir/dynamodb-golf-coach-analyses.json" 2>$null
aws dynamodb scan --table-name golf-coach-analyses --region $region --max-items 5 > "$outputDir/dynamodb-sample-data.json" 2>$null

# 4. S3 Buckets
Write-Host "🪣 Exporting S3 Configuration..." -ForegroundColor Yellow
aws s3api head-bucket --bucket golf-coach-videos-1753203601 --region $region > "$outputDir/s3-bucket-exists.txt" 2>$null
aws s3api get-bucket-location --bucket golf-coach-videos-1753203601 > "$outputDir/s3-bucket-location.json" 2>$null
aws s3api get-bucket-cors --bucket golf-coach-videos-1753203601 > "$outputDir/s3-bucket-cors.json" 2>$null
aws s3api get-bucket-policy --bucket golf-coach-videos-1753203601 > "$outputDir/s3-bucket-policy.json" 2>$null
aws s3 ls s3://golf-coach-videos-1753203601/ --recursive --summarize > "$outputDir/s3-bucket-contents.txt" 2>$null

# 5. IAM Roles (for Lambda functions)
Write-Host "🔐 Exporting IAM Roles..." -ForegroundColor Yellow
foreach ($func in $lambdaFunctions) {
    $role = aws lambda get-function-configuration --function-name $func --region $region --query 'Role' --output text 2>$null
    if ($role) {
        $roleName = ($role -split '/')[-1]
        aws iam get-role --role-name $roleName > "$outputDir/iam-role-$roleName.json" 2>$null
        aws iam list-attached-role-policies --role-name $roleName > "$outputDir/iam-role-$roleName-policies.json" 2>$null
        aws iam list-role-policies --role-name $roleName > "$outputDir/iam-role-$roleName-inline-policies.json" 2>$null
    }
}

# 6. CloudWatch Logs (recent errors)
Write-Host "📊 Exporting Recent CloudWatch Logs..." -ForegroundColor Yellow
foreach ($func in $lambdaFunctions) {
    $logGroup = "/aws/lambda/$func"
    aws logs describe-log-groups --log-group-name-prefix $logGroup --region $region > "$outputDir/logs-$func-groups.json" 2>$null
    
    # Get recent log events (last 1 hour)
    $startTime = [int][double]::Parse((Get-Date).AddHours(-1).ToString("yyyyMMddHHmmss"))
    aws logs filter-log-events --log-group-name $logGroup --start-time $startTime --region $region --max-items 20 > "$outputDir/logs-$func-recent.json" 2>$null
}

# 7. Create a summary file
Write-Host "📋 Creating Architecture Summary..." -ForegroundColor Yellow
@"
# Golf Coach AWS Architecture Summary
Generated: $(Get-Date)
Region: $region

## Key Components Found:
- API Gateway ID: t7y64hqkq0
- DynamoDB Table: golf-coach-analyses  
- S3 Bucket: golf-coach-videos-1753203601
- Lambda Functions: $(($lambdaFunctions -join ', '))

## Files Generated:
$(Get-ChildItem $outputDir | Select-Object Name | ForEach-Object { "- $($_.Name)" } | Out-String)

## Next Steps:
1. Review lambda function configurations for missing environment variables
2. Check API Gateway resources for missing endpoints
3. Verify IAM permissions for all components
4. Check recent CloudWatch logs for specific errors

"@ > "$outputDir/ARCHITECTURE-SUMMARY.md"

Write-Host "✅ Architecture export complete!" -ForegroundColor Green
Write-Host "📁 Check the '$outputDir' folder for all exported files" -ForegroundColor Cyan
Write-Host "📋 Start by reviewing: $outputDir/ARCHITECTURE-SUMMARY.md" -ForegroundColor Cyan

# Display quick status
Write-Host "`n🚀 Quick Status Check:" -ForegroundColor Magenta
Write-Host "Lambda Functions:" -ForegroundColor White
foreach ($func in $lambdaFunctions) {
    $exists = aws lambda get-function-configuration --function-name $func --region $region --query 'FunctionName' --output text 2>$null
    if ($exists) {
        Write-Host "  ✅ $func - EXISTS" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $func - NOT FOUND" -ForegroundColor Red
    }
}

Write-Host "`nAPI Gateway Resources:" -ForegroundColor White
$apiResources = aws apigateway get-resources --rest-api-id t7y64hqkq0 --region $region --query 'items[].pathPart' --output text 2>$null
if ($apiResources) {
    $apiResources -split "`t" | ForEach-Object { 
        if ($_ -ne "None") { Write-Host "  📍 /$_" -ForegroundColor Cyan }
    }
} else {
    Write-Host "  ❌ Could not retrieve API Gateway resources" -ForegroundColor Red
}