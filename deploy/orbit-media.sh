#!/usr/bin/env bash
# Orbit's upload bucket: people's photos now, host logos next (owner, 17 Nov 2026: a private S3 bucket, served by the
# API at api.heyorbit.in/media behind Cloudflare's cache). Run once, in CloudShell as root in the Orbit account:
# orbit-ops can't write S3 or IAM. Safe to run again.
#
# Then, on the server: add MEDIA_BUCKET=heyorbit-media to ~/orbit/api.env and run deploy.sh (or restart orbit-api).
# Until then uploads answer "Photos aren't working right now".
set -euo pipefail
B=heyorbit-media
R=ap-south-1

# Only in Orbit's account (2383-0955-9354), never another one this shell can reach.
[ "$(aws sts get-caller-identity --query Account --output text)" = 238309559354 ] || { echo "Not the Orbit AWS account. Stopping."; exit 1; }

# Private: all four public-access blocks on. New buckets also default to SSE-S3 encryption and owner-only objects.
# No versioning, so a deleted photo is gone (User doc: "A new photo replaces the old file in storage").
aws s3api head-bucket --bucket "$B" 2>/dev/null || aws s3api create-bucket --bucket "$B" --region "$R" --create-bucket-configuration "LocationConstraint=$R"
aws s3api put-public-access-block --bucket "$B" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-tagging --bucket "$B" --tagging 'TagSet=[{Key=project,Value=orbit}]'

# The server's role reads, writes and deletes files in it. ListBucket only so a missing file reads as missing (404)
# rather than "access denied".
aws iam put-role-policy --role-name orbit-box --policy-name orbit-media --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": \"arn:aws:s3:::$B/*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:ListBucket\", \"Resource\": \"arn:aws:s3:::$B\" }
  ]
}"
echo "Done: s3://$B, private; orbit-box can read, write and delete in it."
