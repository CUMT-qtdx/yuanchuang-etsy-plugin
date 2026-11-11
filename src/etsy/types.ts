import type { GenerateRequest } from '../protocol.ts'
import type { FeltApplication, FeltProfile } from './felt/types.ts'
import type { PhotographySettings } from './felt/photography-options.ts'
import type { MultiViewAnchor, MultiViewContext, ViewChecks } from './multi-view/consistency-v1.ts'
import type { MaterialAppearance, MaterialComparison, MaterialReference } from './multi-view/material-lock-v1.ts'
import type { ViewpointCheck } from './multi-view/view-direction-v1.ts'
import type { SpatialIdentity } from './multi-view/spatial-v1.ts'

// 商品档案只保存业务数据，不保存模型密钥。
export type ProductType = 'unspecified' | 'physical_felt' | 'digital_illustration' | 'digital_portrait'
export type CreativityMode = 'gentle' | 'balanced' | 'bold'
export type CreationTask = 'redesign' | 'felt-conversion' | 'flat-to-felt'
export type ReferenceRole = 'subject' | 'detail' | 'material' | 'palette' | 'view'
export interface DesignReference { file: string; role: ReferenceRole; note: string }
export interface ReferenceInput { dataUrl: string; role: ReferenceRole; note: string }
export interface PlanningOptions { count: number; task: CreationTask; references: ReferenceInput[]; previousDirections?: string[]; photography?: PhotographySettings; visualRuleVersion?: string; materialPreset?: import('./felt/types.ts').MaterialPreset }
export type ViewAngle = 'front' | 'three-quarter' | 'left' | 'right' | 'back'
export interface IdentitySpec { summary: string; locks: string[]; unseen: string[]; feltProfile?: FeltProfile; visualRuleVersion?: string; materialAppearance?: MaterialAppearance; spatial?: SpatialIdentity }
export interface FinalDesign { id: string; imageId: string; notes: string; createdAt: number; planning: Stage; spec?: IdentitySpec; specRevision?: number; specHistory?: IdentitySpec[]; approvedImageIds: string[]; requests: Array<{ key: string; imageIds: string[] }>; request: GenerateRequest; multiViewAnchor?: MultiViewAnchor; materialPlanning?: Stage; materialReference?: MaterialReference; sideBackModel?: Pick<GenerateRequest, 'channelId' | 'model'>; directionGuides?: Array<{ facing: 'screen-left' | 'screen-right'; file: string; version: '1.0' }> }
export type StageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'skipped'
export interface ProductFacts {
  name: string
  type: ProductType
  requirements: string
  materials: string
  dimensions: string
  packaging: string
  processing: string
  delivery: string
  personalization: string
  confirmed: boolean
  authenticityConfirmed?: boolean
}
export interface Stage {
  status: StageStatus
  attempts: number
  error?: string
  startedAt?: number
  finishedAt?: number
}
export interface QualityReport {
  status: 'PASS' | 'REVISE' | 'REJECT' | 'UNKNOWN'
  summary: string
  issues: Array<{ area: string; problem: string; suggestion: string; evidence: string }>
  uncertainties: string[]
  assessedAt: number
  model: string
  advisory: true
  viewChecks?: ViewChecks
  materialComparison?: MaterialComparison
  viewpointCheck?: ViewpointCheck
  reviewConflict?: string
}
export interface EtsyCopy {
  titles: Array<{ title: string; titleZh?: string; strategy: string; explanationZh: string; keywords: string[] }>
  selectedTitle: number
  description: string
  sellingPoints: string[]
  tags: string[]
  attributes: Record<string, string>
  deliveryNotes: string
  humanConfirmation: string[]
  factsUsed: Record<string, string>
  reviewRequired: true
  // 局部字段待补齐时保留已完成内容，避免整份文案被隐藏。
  fieldIssues?: Array<{ field: string; message: string }>
}
export interface ProductImage {
  id: string
  visualRules?: FeltApplication
  renderSettings?: Pick<GenerateRequest, 'model' | 'channelId' | 'upstream' | 'quality' | 'detail' | 'size'>
  viewRequest?: GenerateRequest
  materialRepair?: boolean
  viewRestart?: boolean
  kind?: 'view'
  finalDesignId?: string
  angle?: ViewAngle
  viewApproved?: boolean
  identityRevision?: number
  identityDesignId?: string
  taskId?: string
  generation: Stage
  quality: Stage
  copyStage?: Stage
  copyFactsRevision?: number
  copyVersions?: EtsyCopy[]
  files: string[]
  report?: QualityReport
  qualityHistory?: QualityReport[]
  qualityFactsRevision?: number
  planId?: string
  parentImageId?: string
  editInstruction?: string
  version?: number
}
export interface DesignTemplateSlots { subject?: string; quantity?: string; pose?: string; cameraView?: string; facialFeatures?: string; colorPalette?: string }
export interface DesignPlan { id: string; name: string; direction: string; changes: string[]; prompt: string; designBrief?: string; changeAxes?: string[]; feltProfile?: FeltProfile; templateSlots?: DesignTemplateSlots }
export interface ReferencePlan { name: string; summary: string; keep: string[]; uncertainties: string[]; plans: DesignPlan[]; strategyVersion?: 2; creativity?: CreativityMode; task?: CreationTask; references?: Array<{ role: ReferenceRole; note: string }>; feltProfile?: FeltProfile; visualRuleVersion?: string; materialPreset?: import('./felt/types.ts').MaterialPreset }
export interface VisionContext { materialPreset?: import('./felt/types.ts').MaterialPreset; creativity?: CreativityMode; plan?: DesignPlan; editInstruction?: string; identity?: IdentitySpec; angle?: ViewAngle; photography?: PhotographySettings; multiView?: MultiViewContext }
export interface CopyContext { plan?: DesignPlan; image?: string; imageId: string; editInstruction?: string; parentImageId?: string; repair?: EtsyCopy }
export interface CallRecord {
  id: string
  stage: 'generation' | 'quality' | 'copy' | 'planning' | 'identity' | 'material'
  target: string
  status: StageStatus
  model: string
  createdAt: number
  finishedAt?: number
  error?: string
  // 上游不提供实际价格时不假造金额。调用次数是第一版的硬预算。
  cost: null
}
export interface EtsyProduct {
  schema: 1
  source?: 'generated' | 'existing-image' | 'reference'
  copyMode?: 'per-image'
  id: string
  requestKey: string
  createdAt: number
  updatedAt: number
  revision: number
  facts: ProductFacts
  // 用户自定义的创作名称，只影响左侧列表、搜索和导出名；不参与文案生成。
  displayName?: string
  factsRevision?: number
  copyFactsRevision?: number
  planning?: Stage
  referencePlan?: ReferencePlan
  creativity?: 'gentle' | 'balanced' | 'bold'
  creationTask?: CreationTask
  visualRuleVersion?: string
  photography?: PhotographySettings
  designReferences?: DesignReference[]
  copyTiming?: 'all' | 'selected'
  previousProjectId?: string
  round?: number
  previousDirections?: string[]
  finalDesigns?: FinalDesign[]
  finalDesignId?: string
  selectedImageId?: string
  selectionRevision?: number
  selectionConfirmed?: boolean
  copyImageId?: string
  copyRefreshRequested?: boolean
  imageCopies?: Record<string, { copy: EtsyCopy; factsRevision: number }>
  pendingSelection?: { imageId: string; revision: number }
  request: GenerateRequest
  referenceFiles: string[]
  images: ProductImage[]
  copyStage: Stage
  copy?: EtsyCopy
  copyVersions: EtsyCopy[]
  calls: CallRecord[]
  options: { autoCheck: boolean; maxCalls: number; maxStageAttempts: number; timeoutMs: number; autoRevise: false }
  cancelled: boolean
  errors: string[]
}
export interface ProductStart {
  photography?: PhotographySettings
  requestKey: string
  facts: ProductFacts
  generation: GenerateRequest
  count: number
  autoCheck?: boolean
  maxCalls?: number
  timeoutMs?: number
  creationTask?: CreationTask
  references?: ReferenceInput[]
  copyTiming?: 'all' | 'selected'
  previousProjectId?: string
}
export interface EtsyModelSettings {
  etsyAnalysisProvider?: string
  etsyAnalysisModel?: string
  etsyVisionApiUrl?: string
  etsyVisionApiKey?: string
  etsyVisionModel?: string
  etsyCopyApiUrl?: string
  etsyCopyApiKey?: string
  etsyCopyModel?: string
}
export interface StudioModelChoices {
  revision?: number
  writable: boolean
  imageGroups: Array<{ id: string; name: string; models: string[] }>
  image: { channelId: string; model: string }
  analysis: { provider: string; model: string }
  analysisLabel: string
  defaultAnalysisLabel: string
  analysisModels: Array<{ provider: string; providerName: string; model: string; name: string; vision?: boolean }>
  warnings: string[]
}
export interface StudioModelControls {
  read(): Promise<StudioModelChoices>
  save(body: Record<string, unknown>): Promise<StudioModelChoices>
}
export const ETSY_API = '/api/dsh-imagegen/etsy'
export const emptyStage = (): Stage => ({ status: 'queued', attempts: 0 })
