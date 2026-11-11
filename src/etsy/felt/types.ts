import type { PhotographySettings } from './photography-options.ts'
import type { MultiViewContext } from '../multi-view/consistency-v1.ts'

export type FeltPart = 'body' | 'face' | 'hair' | 'beard' | 'wings' | 'petals' | 'leaves' | 'shell' | 'clothing' | 'trim' | 'felt-accessories' | 'curly-overlay'
export type MixedMaterial = 'bead-eyes' | 'wire-glasses' | 'paper' | 'woven-ribbon' | 'whiskers'
export type FeltScene = 'minimal' | 'lifestyle' | 'autumn' | 'christmas' | 'study'
export type FeltAdapter = 'gpt-image' | 'gemini' | 'grok' | 'generic'
export type FeltStage = 'generation' | 'refinement' | 'multi-view'
export type MaterialPreset = 'needle_felt_v1_0' | 'needle_felt_v1_0_2' | 'needle_felt_v2_0'
export interface MaterialPlanV2 { version: '2.0'; parts: Array<{ part: string; material: string; treatment: 'felt' | 'retain' | 'unspecified' }> }
export type MaterialComponentCategory = 'sculpted_needle_felt' | 'loose_wool_or_curly_fleece' | 'flat_felt_sheet' | 'woven_or_knitted_clothing' | 'mixed_material_accessory'
export type MaterialRegion = 'body' | 'face' | 'ears' | 'limbs' | 'clothing' | 'accessory'
export interface MaterialComponent { part: string; category: MaterialComponentCategory; region?: MaterialRegion; evidence?: string; observedMaterial?: string }
export interface MaterialCorrection { field: string; before: string; after: string; reason: string }
export interface FeltProfile {
  components: FeltPart[]
  mixedMaterials: MixedMaterial[]
  tones: Array<'light' | 'dark'>
  scene: FeltScene
  materialComponents?: MaterialComponent[]
  materialPlan?: MaterialPlanV2
}
export interface FeltRequestContext {
  version: string
  materialPreset?: MaterialPreset
  stage: FeltStage
  task: 'redesign' | 'felt-conversion' | 'flat-to-felt'
  profile: FeltProfile
  // 原始设计要求单独保存；模型切换时重组规则，不在已有规则文本上重复追加。
  basePrompt: string
  userRequirements: string
  latestInstruction?: string
  multiReference: boolean
  photography: PhotographySettings
  multiView?: MultiViewContext
}
export interface FeltApplication {
  library: 'etsy-real-needle-felt'
  version: string
  materialPreset?: MaterialPreset
  materialRevision?: '3' | '1'
  materialCorrections?: MaterialCorrection[]
  materialNotes?: string[]
  sourceSha256: string
  adapter: FeltAdapter
  model: string
  stage: FeltStage
  task: FeltRequestContext['task']
  ruleIds: string[]
  profile: FeltProfile
  prompt: string
  modules: { needle_felt_v1_0?: string; needle_felt_v1_0_2?: string; needle_felt_v2_0?: string; felt_photography_v1_0?: string; felt_composition_v1_0?: string; custom_background_v1_0?: string; multi_view_consistency_v1_0?: string; approved_material_lock_v1_0?: string; hero_surface_continuity_v1_0?: string; product_view_direction_v1_0?: string; product_spatial_v1_0?: string }
  photography: PhotographySettings
  multiView?: MultiViewContext
}
