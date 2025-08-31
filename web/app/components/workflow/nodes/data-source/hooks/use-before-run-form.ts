import { useStoreApi } from 'reactflow'
import type { CustomRunFormProps, DataSourceNodeType } from '../types'
import { useEffect, useRef } from 'react'
import { useNodeDataUpdate, useNodesSyncDraft } from '../../../hooks'
import { NodeRunningStatus } from '../../../types'
import { useInvalidLastRun } from '@/service/use-workflow'
import type { NodeRunResult } from '@/types/workflow'
import { fetchNodeInspectVars } from '@/service/workflow'
import { FlowType } from '@/types/common'
import { useDatasourceSingleRun } from '@/service/use-pipeline'
import { useDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'

const useBeforeRunForm = ({
  nodeId,
  flowId,
  flowType,
  payload,
  setRunResult,
  isPaused,
  isRunAfterSingleRun,
  setIsRunAfterSingleRun,
  onSuccess,
  appendNodeInspectVars,
}: CustomRunFormProps) => {
  const store = useStoreApi()
  const dataSourceStore = useDataSourceStore()
  const isPausedRef = useRef(isPaused)
  const { handleNodeDataUpdate } = useNodeDataUpdate()

  const datasourceType = payload.provider_type as DatasourceType
  const datasourceNodeData = payload as DataSourceNodeType

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const runningStatus = payload._singleRunningStatus || NodeRunningStatus.NotStart

  const setNodeRunning = () => {
    handleNodeDataUpdate({
      id: nodeId,
      data: {
        ...payload,
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })
  }

  const invalidLastRun = useInvalidLastRun(flowType, flowId, nodeId)

  const updateRunResult = async (data: NodeRunResult) => {
    const isPaused = isPausedRef.current

    // The backend don't support pause the single run, so the frontend handle the pause state.
    if (isPaused)
      return

    const canRunLastRun = !isRunAfterSingleRun || runningStatus === NodeRunningStatus.Succeeded
    if (!canRunLastRun) {
      setRunResult(data)
      return
    }

    // run fail may also update the inspect vars when the node set the error default output.
    const vars = await fetchNodeInspectVars(FlowType.ragPipeline, flowId, nodeId)
    const { getNodes } = store.getState()
    const nodes = getNodes()
    appendNodeInspectVars(nodeId, vars, nodes)
    if (data?.status === NodeRunningStatus.Succeeded)
      onSuccess()
  }

  const { mutateAsync: handleDatasourceSingleRun, isPending } = useDatasourceSingleRun()

  const handleRun = () => {
    let datasourceInfo: Record<string, any> = {}
    const { currentCredentialId: credentialId } = dataSourceStore.getState()
    if (datasourceType === DatasourceType.localFile) {
      const { localFileList } = dataSourceStore.getState()
      const { id, name, type, size, extension, mime_type } = localFileList[0].file
      const documentInfo = {
        related_id: id,
        name,
        type,
        size,
        extension,
        mime_type,
        url: '',
        transfer_method: TransferMethod.local_file,
      }
      datasourceInfo = documentInfo
    }
    if (datasourceType === DatasourceType.onlineDocument) {
      const { onlineDocuments } = dataSourceStore.getState()
      const { workspace_id, ...rest } = onlineDocuments[0]
      const documentInfo = {
        workspace_id,
        page: rest,
        credential_id: credentialId,
      }
      datasourceInfo = documentInfo
    }
    if (datasourceType === DatasourceType.websiteCrawl) {
      const { websitePages } = dataSourceStore.getState()
      datasourceInfo = {
        ...websitePages[0],
        credential_id: credentialId,
      }
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      const { bucket, onlineDriveFileList, selectedFileIds } = dataSourceStore.getState()
      const file = onlineDriveFileList.find(file => file.id === selectedFileIds[0])
      datasourceInfo = {
        bucket,
        id: file?.id,
        type: file?.type,
        credential_id: credentialId,
      }
    }
    let hasError = false
    handleDatasourceSingleRun({
      pipeline_id: flowId,
      start_node_id: nodeId,
      start_node_title: datasourceNodeData.title,
      datasource_type: datasourceType,
      datasource_info: datasourceInfo,
    }, {
      onError: () => {
        hasError = true
        invalidLastRun()
        if (isPausedRef.current)
          return
        handleNodeDataUpdate({
          id: nodeId,
          data: {
            ...payload,
            _isSingleRun: false,
            _singleRunningStatus: NodeRunningStatus.Failed,
          },
        })
      },
      onSettled: (data) => {
        updateRunResult(data!)
        if (!hasError && !isPausedRef.current) {
          handleNodeDataUpdate({
            id: nodeId,
            data: {
              ...payload,
              _isSingleRun: false,
              _singleRunningStatus: NodeRunningStatus.Succeeded,
            },
          })
        }
      },
    })
  }

  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleRunWithSyncDraft = () => {
    setNodeRunning()
    setIsRunAfterSingleRun(true)
    handleSyncWorkflowDraft(true, true, {
      onSuccess() {
        handleRun()
      },
    })
  }

  return {
    isPending,
    handleRunWithSyncDraft,
    datasourceType,
    datasourceNodeData,
  }
}

export default useBeforeRunForm
