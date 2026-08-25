targetScope = 'resourceGroup'

@description('Azure region for the MonoField container group and storage account.')
param location string = resourceGroup().location

@description('Container group name.')
param containerGroupName string = 'monofield'

@description('DNS label for the Azure Container Instances upstream endpoint. Must be unique in the selected region.')
param dnsNameLabel string = toLower('monofield-${uniqueString(resourceGroup().id, location)}')

@description('MonoField container image.')
param image string = 'ghcr.io/jhy0285/monofield:latest'

@secure()
@description('Required MonoField API token. Generate with: openssl rand -hex 32')
param monofieldApiToken string

@description('Comma-separated browser-visible origins allowed by the daemon. Set this to the authenticated reverse proxy origin, for example https://monofield.example.com.')
param allowedOrigins string = ''

@description('Node.js heap cap inside the container.')
param nodeOptions string = '--max-old-space-size=192'

@description('CPU cores requested by the container.')
@minValue(1)
param cpuCores int = 1

@description('Memory requested by the container in GiB.')
@minValue(1)
param memoryInGB int = 1

@description('Azure Files share quota in GiB for persistent MonoField data.')
@minValue(1)
@maxValue(5120)
param fileShareQuotaGB int = 10

var storageAccountName = take(toLower('monofield${uniqueString(resourceGroup().id, location)}'), 24)
var fileShareName = 'opendesigndata'
var appPort = 7456

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource dataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: fileShareQuotaGB
  }
}

resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: containerGroupName
  location: location
  properties: {
    osType: 'Linux'
    restartPolicy: 'Always'
    sku: 'Standard'
    ipAddress: {
      type: 'Public'
      dnsNameLabel: dnsNameLabel
      ports: [
        {
          protocol: 'TCP'
          port: appPort
        }
      ]
    }
    containers: [
      {
        name: 'monofield'
        properties: {
          image: image
          ports: [
            {
              protocol: 'TCP'
              port: appPort
            }
          ]
          environmentVariables: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'NODE_OPTIONS'
              value: nodeOptions
            }
            {
              name: 'MONOFIELD_BIND_HOST'
              value: '0.0.0.0'
            }
            {
              name: 'MONOFIELD_PORT'
              value: string(appPort)
            }
            {
              name: 'MONOFIELD_WEB_PORT'
              value: string(appPort)
            }
            {
              name: 'MONOFIELD_DATA_DIR'
              value: '/app/.monofield'
            }
            {
              name: 'MONOFIELD_ALLOWED_ORIGINS'
              value: allowedOrigins
            }
            {
              name: 'MONOFIELD_API_TOKEN'
              secureValue: monofieldApiToken
            }
          ]
          resources: {
            requests: {
              cpu: cpuCores
              memoryInGB: memoryInGB
            }
          }
          volumeMounts: [
            {
              name: 'monofield-data'
              mountPath: '/app/.monofield'
              readOnly: false
            }
          ]
          livenessProbe: {
            httpGet: {
              path: '/api/health'
              port: appPort
              scheme: 'http'
            }
            initialDelaySeconds: 30
            periodSeconds: 30
            failureThreshold: 3
            timeoutSeconds: 5
          }
        }
      }
    ]
    volumes: [
      {
        name: 'monofield-data'
        azureFile: {
          shareName: dataShare.name
          storageAccountName: storageAccount.name
          storageAccountKey: listKeys(storageAccount.id, storageAccount.apiVersion).keys[0].value
          readOnly: false
        }
      }
    ]
  }
}

output daemonFqdn string = containerGroup.properties.ipAddress.fqdn
output proxyUpstreamUrl string = 'http://${containerGroup.properties.ipAddress.fqdn}:${appPort}'
output storageAccountName string = storageAccount.name
output fileShareName string = dataShare.name
