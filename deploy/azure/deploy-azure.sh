#!/usr/bin/env bash
set -euo pipefail

# Deploy MonoField to Azure from the Bicep templates in this directory.
#
#   deploy/azure/deploy-azure.sh --target app-service --resource-group monofield-rg --location eastus
#   deploy/azure/deploy-azure.sh --target aci         --resource-group monofield-rg --location eastus
#
# Requires the Azure CLI (`az`) and an authenticated session (`az login`).
# If no --api-token is given, a 32-byte hex token is generated and printed so
# you can save it for client configuration.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET="${TARGET:-app-service}"
RESOURCE_GROUP="${RESOURCE_GROUP:-monofield-rg}"
LOCATION="${LOCATION:-eastus}"
NAME="${NAME:-monofield}"
IMAGE="${IMAGE:-ghcr.io/jhy0285/monofield:latest}"
API_TOKEN="${API_TOKEN:-}"
EXTRA_ALLOWED_ORIGINS="${EXTRA_ALLOWED_ORIGINS:-}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-monofield}"

usage() {
  cat <<'EOF'
Usage: deploy/azure/deploy-azure.sh [options]

Options:
  --target <app-service|aci>      deployment lane (default: app-service)
  --resource-group <name>         resource group to deploy into (default: monofield-rg)
  --location <region>             Azure region, used to create the group (default: eastus)
  --name <name>                   base name for resources (default: monofield)
  --image <image-ref>             container image (default: ghcr.io/jhy0285/monofield:latest)
  --api-token <token>             API token; generated with `openssl rand -hex 32` if omitted
  --extra-allowed-origins <list>  extra comma-separated browser origins for /api
  --deployment-name <name>        ARM deployment name (default: monofield)
  -h, --help

Examples:
  deploy/azure/deploy-azure.sh --target app-service --resource-group monofield-rg --location westeurope
  deploy/azure/deploy-azure.sh --target aci --resource-group monofield-rg --image ghcr.io/jhy0285/monofield@sha256:<digest>
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --api-token) API_TOKEN="$2"; shift 2 ;;
    --extra-allowed-origins) EXTRA_ALLOWED_ORIGINS="$2"; shift 2 ;;
    --deployment-name) DEPLOYMENT_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown argument: $1" ;;
  esac
done

case "$TARGET" in
  app-service) TEMPLATE="$ROOT_DIR/app-service.bicep" ;;
  aci) TEMPLATE="$ROOT_DIR/aci.bicep" ;;
  *) die "--target must be 'app-service' or 'aci' (got: $TARGET)" ;;
esac

command -v az >/dev/null 2>&1 || die "Azure CLI ('az') not found. Install it: https://learn.microsoft.com/cli/azure/install-azure-cli"
az account show >/dev/null 2>&1 || die "not logged in. Run 'az login' first."

if [[ -z "$API_TOKEN" ]]; then
  command -v openssl >/dev/null 2>&1 || die "openssl not found; pass --api-token explicitly."
  API_TOKEN="$(openssl rand -hex 32)"
  echo "Generated MONOFIELD_API_TOKEN: $API_TOKEN"
  echo "Save this token — clients need it to call the API."
fi

echo "Ensuring resource group '$RESOURCE_GROUP' in '$LOCATION'..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "Deploying '$TARGET' template..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DEPLOYMENT_NAME" \
  --template-file "$TEMPLATE" \
  --parameters \
    name="$NAME" \
    image="$IMAGE" \
    apiToken="$API_TOKEN" \
    extraAllowedOrigins="$EXTRA_ALLOWED_ORIGINS" \
  --output none

APP_URL="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query 'properties.outputs.appUrl.value' --output tsv)"
HEALTH_URL="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query 'properties.outputs.healthUrl.value' --output tsv)"

echo
echo "Deployment complete."
echo "  App URL:    $APP_URL"
echo "  Health:     $HEALTH_URL"
echo
echo "First container start can take a couple of minutes while the image is pulled."
echo "Poll the health endpoint until it returns ok:"
echo "  curl -fsS $HEALTH_URL"
