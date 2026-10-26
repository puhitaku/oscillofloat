#!/bin/bash
# Usage: scripts/set-dns.sh
# Points DOMAIN_NAME (A and AAAA) at the CloudFront distribution.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION DOMAIN_NAME HOSTED_ZONE_ID

distribution_domain="$(main_output DistributionDomainName)"

cloudfront_hosted_zone_id=Z2FDTNDATAQYW2
change_batch="$(cat <<JSON
{
  "Comment": "oscillofloat",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$DOMAIN_NAME",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "$cloudfront_hosted_zone_id",
          "DNSName": "$distribution_domain",
          "EvaluateTargetHealth": false
        }
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$DOMAIN_NAME",
        "Type": "AAAA",
        "AliasTarget": {
          "HostedZoneId": "$cloudfront_hosted_zone_id",
          "DNSName": "$distribution_domain",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
JSON
)"

change_id="$(aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$change_batch" \
  --query ChangeInfo.Id --output text)"
echo "waiting for $change_id"
aws route53 wait resource-record-sets-changed --id "$change_id"
echo "$DOMAIN_NAME -> $distribution_domain"
