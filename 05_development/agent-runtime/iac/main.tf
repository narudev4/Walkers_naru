###############################################################################
# Walkers Agent Runtime Infrastructure
#
# ECR + ECS Fargate Service + IAM + Secrets Manager + EventBridge Scheduler.
# 前提: /aws-bootstrap で S3 バケットは作成済。
#
# 適用手順:
#   cd 05_development/agent-runtime/iac
#   terraform init
#   terraform plan -var="anthropic_api_key=sk-ant-..." \
#                  -var="google_oauth_tokens_json=$(cat ~/.config/google-workspace-mcp/tokens.json)"
#   terraform apply
###############################################################################

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
  # backend "s3" {
  #   bucket = "walkers-context-prod"
  #   key    = "iac/agent-runtime.tfstate"
  #   region = "ap-northeast-1"
  # }
}

provider "aws" {
  region = var.aws_region
}

###############################################################################
# Variables
###############################################################################

variable "aws_region" {
  description = "AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "data_bucket" {
  description = "S3 データバケット (aws-bootstrap で作成済を指定)"
  type        = string
  default     = "walkers-context-prod"
}

variable "anthropic_api_key" {
  description = "Anthropic API key (Secrets Manager に保存される)"
  type        = string
  sensitive   = true
}

variable "google_oauth_tokens_json" {
  description = "Google Workspace MCP の OAuth トークン JSON 全文"
  type        = string
  sensitive   = true
}

variable "image_tag" {
  description = "ECR にプッシュ済のイメージタグ (初回は latest)"
  type        = string
  default     = "latest"
}

variable "fargate_cpu" {
  description = "Fargate タスクの CPU (256, 512, 1024 ...)"
  type        = number
  default     = 256
}

variable "fargate_memory" {
  description = "Fargate タスクのメモリ MB"
  type        = number
  default     = 512
}

variable "use_fargate_spot" {
  description = "Fargate Spot を使う (常駐 daemon は Spot 中断耐性が必要なので注意)"
  type        = bool
  default     = false
}

###############################################################################
# Networking — デフォルト VPC をそのまま使う (production 向きではないが MVP)
###############################################################################

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "agent" {
  name        = "walkers-agent-sg"
  description = "Outbound only for walkers-agent ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

###############################################################################
# ECR
###############################################################################

resource "aws_ecr_repository" "agent" {
  name                 = "walkers-agent"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "agent" {
  repository = aws_ecr_repository.agent.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "古いイメージを 10 件まで保持"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

###############################################################################
# Secrets Manager
###############################################################################

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name        = "walkers/anthropic-api-key"
  description = "Anthropic API key for walkers-agent"
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

resource "aws_secretsmanager_secret" "google_oauth_tokens" {
  name        = "walkers/google-oauth-tokens"
  description = "Google Workspace MCP OAuth tokens (JSON 全文)"
}

resource "aws_secretsmanager_secret_version" "google_oauth_tokens" {
  secret_id     = aws_secretsmanager_secret.google_oauth_tokens.id
  secret_string = var.google_oauth_tokens_json
}

###############################################################################
# IAM
###############################################################################

# ECS タスク実行ロール (Secrets Manager 読み込み + ECR pull + CW Logs)
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "walkers-agent-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_ecr" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  role = aws_iam_role.task_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.anthropic_api_key.arn,
        aws_secretsmanager_secret.google_oauth_tokens.arn,
      ]
    }]
  })
}

# Agent タスクロール (S3 read/write + Secrets Manager + CW Logs)
resource "aws_iam_role" "task_role" {
  name               = "walkers-agent-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_role_s3" {
  role = aws_iam_role.task_role.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
          "s3:GetObjectVersion", "s3:ListBucketMultipartUploads",
          "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
        ]
        Resource = "arn:aws:s3:::${var.data_bucket}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::${var.data_bucket}"
      },
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue", "secretsmanager:UpdateSecret"]
        Resource = [
          aws_secretsmanager_secret.anthropic_api_key.arn,
          aws_secretsmanager_secret.google_oauth_tokens.arn,
        ]
      }
    ]
  })
}

###############################################################################
# CloudWatch Logs
###############################################################################

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/walkers-agent"
  retention_in_days = 30
}

###############################################################################
# ECS Cluster + Service (常駐 daemon)
###############################################################################

resource "aws_ecs_cluster" "agent" {
  name = "walkers-agent"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "agent_daemon" {
  family                   = "walkers-agent-daemon"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.fargate_cpu
  memory                   = var.fargate_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([{
    name      = "agent"
    image     = "${aws_ecr_repository.agent.repository_url}:${var.image_tag}"
    essential = true
    command   = ["python", "agent.py", "--mode", "daemon"]
    environment = [
      { name = "WALKERS_S3_BUCKET", value = var.data_bucket },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "WALKERS_GOOGLE_ACCOUNT", value = "naru.hosoya@walker-s.co.jp" },
      { name = "WALKERS_GOOGLE_OAUTH_SECRET_ID", value = aws_secretsmanager_secret.google_oauth_tokens.name },
      { name = "WALKERS_ANTHROPIC_SECRET_ID", value = aws_secretsmanager_secret.anthropic_api_key.name },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.agent.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "daemon"
      }
    }
  }])
}

resource "aws_ecs_service" "agent_daemon" {
  name            = "walkers-agent-daemon"
  cluster         = aws_ecs_cluster.agent.id
  task_definition = aws_ecs_task_definition.agent_daemon.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.agent.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
}

###############################################################################
# EventBridge Scheduler (morning / evening RunTask)
###############################################################################

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "walkers-agent-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.task_execution.arn, aws_iam_role.task_role.arn]
      }
    ]
  })
}

resource "aws_ecs_task_definition" "agent_oneshot" {
  family                   = "walkers-agent-oneshot"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.fargate_cpu
  memory                   = var.fargate_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([{
    name      = "agent"
    image     = "${aws_ecr_repository.agent.repository_url}:${var.image_tag}"
    essential = true
    # command は scheduler 側で override (morning/evening 両対応)
    command = ["python", "scheduled_morning.py"]
    environment = [
      { name = "WALKERS_S3_BUCKET", value = var.data_bucket },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "WALKERS_GOOGLE_ACCOUNT", value = "naru.hosoya@walker-s.co.jp" },
      { name = "WALKERS_GOOGLE_OAUTH_SECRET_ID", value = aws_secretsmanager_secret.google_oauth_tokens.name },
      { name = "WALKERS_ANTHROPIC_SECRET_ID", value = aws_secretsmanager_secret.anthropic_api_key.name },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.agent.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "oneshot"
      }
    }
  }])
}

resource "aws_scheduler_schedule" "morning" {
  name       = "walkers-agent-morning"
  group_name = "default"
  flexible_time_window { mode = "OFF" }
  schedule_expression          = "cron(0 6 * * ? *)"
  schedule_expression_timezone = "Asia/Tokyo"
  state                        = "ENABLED"

  target {
    arn      = aws_ecs_cluster.agent.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.agent_oneshot.arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = data.aws_subnets.default.ids
        security_groups  = [aws_security_group.agent.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [{
        name    = "agent"
        command = ["python", "scheduled_morning.py"]
      }]
    })
  }
}

resource "aws_scheduler_schedule" "evening" {
  name       = "walkers-agent-evening"
  group_name = "default"
  flexible_time_window { mode = "OFF" }
  schedule_expression          = "cron(0 22 * * ? *)"
  schedule_expression_timezone = "Asia/Tokyo"
  state                        = "ENABLED"

  target {
    arn      = aws_ecs_cluster.agent.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.agent_oneshot.arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = data.aws_subnets.default.ids
        security_groups  = [aws_security_group.agent.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [{
        name    = "agent"
        command = ["python", "scheduled_evening.py"]
      }]
    })
  }
}

###############################################################################
# Outputs
###############################################################################

output "ecr_repository_url" {
  value = aws_ecr_repository.agent.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.agent.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.agent.name
}

output "deploy_command" {
  value = "aws ecs update-service --cluster ${aws_ecs_cluster.agent.name} --service ${aws_ecs_service.agent_daemon.name} --force-new-deployment --region ${var.aws_region}"
}
