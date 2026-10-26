# Deploying oscillofloat

Everything runs in one AWS account:

```
visitor ── https ──> CloudFront ──┬── default ──────> S3 (frontend bundle, private, OAC)
                     (DOMAIN_NAME)└── /ws, /api/* ──> EC2 :8080 (Elastic IP, SG: CloudFront only)
                                                       │ Litestream
                                                       └──> S3 (database replica, outside the stack)
```

| piece                                                 | where                     | made by                       |
| ----------------------------------------------------- | ------------------------- | ----------------------------- |
| ACM certificate and its DNS validation record         | us-east-1                 | `infra/cert.yaml`             |
| VPC, EC2, Elastic IP, S3 buckets, CloudFront, Cognito | `AWS_REGION`              | `infra/stack.yaml`            |
| database replica bucket                               | `AWS_REGION`              | `scripts/create-db-bucket.sh` |
| A and AAAA alias records                              | Route 53                  | `scripts/set-dns.sh`          |
| operator account                                      | Cognito                   | `scripts/create-admin.sh`     |
| backend binary, frontend bundle                       | S3, then EC2 / CloudFront | `scripts/deploy-*.sh`         |

The instance is Amazon Linux 2023 on arm64 with no SSH key; it is reached
through Systems Manager only. The backend runs as `oscillofloat.service`
under `litestream replicate -exec`, so every write to
`/var/lib/oscillofloat/db.sqlite` is copied to `s3://$DATABASE_BUCKET/db`
within about a second, and an empty instance restores the database from
there before it starts.

## Requirements

- AWS CLI v2, signed in to the target account (`aws sso login`, `aws login`
  or any other credential source).
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  for `aws ssm start-session` (optional; the scripts do not need it).
- Go 1.26, Node.js and `make` to build.
- A Route 53 public hosted zone for the domain or one of its parents.

Every script loads `deploy.env` from the repository root and can be run from
any directory.

## First deployment

1. **Sign in** to the AWS CLI and check the account:

   ```sh
   aws sts get-caller-identity
   ```

2. **Configure.** Copy `deploy.env.example` to `deploy.env` and fill in every
   key. `deploy.env` is git-ignored; keep it that way.

3. **Create the database bucket.** Idempotent.

   ```sh
   scripts/create-db-bucket.sh
   ```

4. **Issue the certificate** in us-east-1. CloudFormation creates the DNS
   validation record in `HOSTED_ZONE_ID` and waits until ACM has issued the
   certificate, usually a few minutes.

   ```sh
   scripts/deploy-cert.sh
   ```

5. **Deploy the main stack.** The script looks up the CloudFront
   origin-facing prefix list and the certificate ARN, deploys, and prints the
   outputs. The CloudFront distribution takes most of the time (up to about
   15 minutes).

   ```sh
   scripts/deploy-stack.sh
   ```

   The instance boots without the backend binary; the service stays down
   until the next step but one.

6. **Point the domain** at the distribution:

   ```sh
   scripts/set-dns.sh
   ```

7. **Deploy the backend.** Builds `dist/oscillofloat` for linux/arm64, uploads
   it to the deploy bucket and runs `/usr/local/bin/oscillofloat-update` on
   the instance through SSM, which installs the binary and (re)starts the
   service. If the script says the instance is not registered with SSM yet,
   wait a few minutes after the stack deployment and run it again.

   ```sh
   scripts/deploy-backend.sh
   ```

8. **Deploy the frontend.** Builds `frontend/dist`, syncs it to the frontend
   bucket (hashed `assets/` cached for a year, everything else `no-cache`) and
   invalidates the distribution.

   ```sh
   scripts/deploy-frontend.sh
   ```

9. **Create the operator account.** Cognito generates a temporary password
   and mails it with the sign-in instructions. Not idempotent: running it
   twice for the same address fails.

   ```sh
   scripts/create-admin.sh operator@example.com
   ```

10. **First sign-in.** Open `https://DOMAIN_NAME/admin`, expand 「初回設定」
    (first-time setup), enter the email address and the temporary password,
    choose a new password (16 characters or more, with upper and lower case
    letters, digits and symbols), and register a passkey when the browser
    asks. From then on, sign in with 「パスキーでログイン」. The temporary
    password expires after 7 days; if it does, delete the user and create it
    again:

    ```sh
    aws cognito-idp admin-delete-user --user-pool-id POOL_ID --username operator@example.com
    ```

    Passkeys are bound to `DOMAIN_NAME`, so this only works on the deployed
    site, never on localhost.

## Updating

| what changed                        | run                          | downtime                     |
| ----------------------------------- | ---------------------------- | ---------------------------- |
| backend code                        | `scripts/deploy-backend.sh`  | a restart, about a second    |
| frontend code                       | `scripts/deploy-frontend.sh` | none                         |
| `infra/stack.yaml`                  | `scripts/deploy-stack.sh`    | depends on the change        |
| `UPLOAD_RATE`, `LITESTREAM_VERSION` | `scripts/deploy-stack.sh`    | a stop and start, 1 to 2 min |

Things to know about stack updates:

- **The AMI follows the newest Amazon Linux 2023.** The `LatestAmiId`
  parameter is resolved again on every deployment, and a new image replaces
  the instance. `deploy-stack.sh` says so before it deploys. Replacement is
  safe: the new instance installs the last uploaded binary from the deploy
  bucket and restores the database from the replica. The Elastic IP moves to
  the new instance before the old one is terminated, which also cuts the old
  one off from S3, so the two never replicate at the same time; writes in
  the last second before the move may be lost.
- **UserData changes stop and start the instance.** The setup script runs on
  every boot, so the new settings apply once it is back.
- **Changing `DOMAIN_NAME`** means a new certificate (`deploy-cert.sh`), a
  stack update, `set-dns.sh`, and new passkeys: the relying party ID changes.

## Inspecting

```sh
scripts/logs.sh            # last 200 lines of the service's journal
scripts/logs.sh 1000       # more (SSM returns at most 24000 characters)
```

A shell on the instance (needs the Session Manager plugin):

```sh
aws ssm start-session --target INSTANCE_ID
```

Useful there:

```sh
sudo systemctl status oscillofloat
sudo journalctl -u oscillofloat -f
sudo cat /var/log/cloud-init-output.log                 # the setup script's output
sudo -u oscillofloat litestream generations /var/lib/oscillofloat/db.sqlite
sudo -u oscillofloat litestream snapshots /var/lib/oscillofloat/db.sqlite
sudo /usr/local/bin/oscillofloat-update                 # reinstall the uploaded binary and restart
```

The setup script also prints to the serial console, which works even when
SSM does not:

```sh
aws ec2 get-console-output --instance-id INSTANCE_ID --latest --output text
```

To get a copy of the database on your own machine, with Litestream 0.3
installed locally:

```sh
litestream restore -o oscillofloat.sqlite s3://DATABASE_BUCKET/db
```

## Tearing down

The database replica lives in `DATABASE_BUCKET`, which is not part of any
stack, so the drawings survive all of this. A new stack restores them on its
first start.

1. Lift the user pool's deletion protection. Deleting the pool also deletes
   the operator account and its passkeys.

   ```sh
   USER_POOL_DELETION_PROTECTION=INACTIVE scripts/deploy-stack.sh
   ```

2. Empty the two buckets the stack owns (CloudFormation does not delete
   buckets that still hold objects):

   ```sh
   aws s3 rm --recursive s3://FRONTEND_BUCKET
   aws s3 rm --recursive s3://DEPLOY_BUCKET
   ```

3. Delete the alias records `set-dns.sh` created (A and AAAA for
   `DOMAIN_NAME`) in the Route 53 console or with
   `aws route53 change-resource-record-sets` and `"Action": "DELETE"`.

4. Delete the main stack, then the certificate stack:

   ```sh
   aws cloudformation delete-stack --stack-name STACK_NAME
   aws cloudformation wait stack-delete-complete --stack-name STACK_NAME
   aws cloudformation delete-stack --region us-east-1 --stack-name CERT_STACK_NAME
   aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name CERT_STACK_NAME
   ```

   Afterwards, check that the `_….DOMAIN_NAME` validation CNAME is gone
   from the hosted zone and delete it if it is not.

To delete the data as well, empty and delete `DATABASE_BUCKET` last.

## Cost

Rough monthly figures for ap-northeast-1 with light traffic:

| item                             | per month                                        |
| -------------------------------- | ------------------------------------------------ |
| EC2 t4g.nano (on demand)         | ~$4.0                                            |
| public IPv4 address (Elastic IP) | ~$3.7                                            |
| EBS gp3, 8 GiB                   | ~$0.8                                            |
| Route 53 hosted zone (if new)    | $0.5                                             |
| S3 (bundle, binary, replica)     | < $0.1                                           |
| CloudFront                       | $0 within the always-free 1 TB and 10 M requests |
| Cognito Essentials               | $0 within 10,000 monthly active users            |
| Systems Manager, ACM             | $0                                               |
| **total**                        | **~$9**                                          |

A busy installation adds CloudFront requests and data beyond the free tier,
and Litestream's S3 requests, which grow with the number of uploads.
