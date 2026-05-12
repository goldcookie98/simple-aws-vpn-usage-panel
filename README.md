# ec2-data-monitor

A serverless AWS Lambda function that renders a live dashboard showing your EC2 instance's monthly network data usage and AWS costs — accessible via a public URL in your browser.

![Dashboard preview: half-circle gauge, stat cards for used/remaining/upload/download GB, and AWS cost]

## Features

- 📊 Half-circle gauge showing % of monthly data cap used
- 📦 Total used, remaining, download, and upload in GB
- 💰 AWS cost used this month (CAN COST)
- 🟢 Colour-coded: green → amber → red as you approach your cap
- 🔄 Live data on every page refresh

## Setup

### 1. Create a Lambda Function

1. Go to [AWS Lambda](https://console.aws.amazon.com/lambda) and create a new function
2. Choose **Author from scratch**
3. Runtime: `Node.js 22.x`
4. Click **Create function**

### 2. Deploy the code

Copy the contents of `index.mjs` into the Lambda code editor and click **Deploy**.

### 3. Set Environment Variables

Go to **Configuration → Environment variables** and add:

| Key | Value | Required |
|-----|-------|----------|
| `INSTANCE_ID` | Your EC2 instance ID, e.g. `i-0abc123def456789` | ✅ |
| `DATA_CAP_GB` | Your monthly data cap in GB, e.g. `100` | ✅ |

> `AWS_REGION` is set automatically by Lambda — do not add it manually.

### 4. Add IAM Permissions

Attach these managed policies to your Lambda's execution role (**IAM → Roles → your-function-role**):

- `CloudWatchReadOnlyAccess`
- `AmazonEC2ReadOnlyAccess`
- `AWSBillingReadOnlyAccess` (Dont add this policy if you dont want to see your billing as calling this api cost $0.01 per call of your precious credits)

### 5. Create a Function URL

Go to **Configuration → Function URL → Create function URL**:
- Auth type: **None** (public)
- Click **Save**

Open the generated URL in your browser — you'll see the dashboard.

## Requirements

- An EC2 instance with CloudWatch metrics enabled (enabled by default)
- Lambda execution role with the IAM policies listed above
- Node.js 22.x runtime

## Cost

This uses AWS free tier services:
- Lambda: 1M free requests/month
- CloudWatch: read metrics are free
- Cost Explorer API: $0.01 per request (very cheap for occasional use)

## License

MIT
