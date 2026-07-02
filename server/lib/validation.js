import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().trim().min(2, "用户名至少需要 2 个字符。"),
  password: z.string().min(4, "密码至少需要 4 个字符。"),
  inviteCode: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "用户名不能为空。"),
  password: z.string().min(1, "密码不能为空。"),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "当前密码不能为空。"),
  newPassword: z.string().min(4, "新密码至少需要 4 个字符。"),
});

export const appSettingsSchema = z.object({
  showChatFocusOutline: z.boolean().optional(),
  hideWideScreenSideBranches: z.boolean().optional(),
  showChatAdaptationButtons: z.boolean().optional(),
  showContextIgnoreButton: z.boolean().optional(),
  showSummaryPreferButton: z.boolean().optional(),
  showSummaryPinButton: z.boolean().optional(),
  showSummaryGenerateButton: z.boolean().optional(),
  showImportantLabelButton: z.boolean().optional(),
  showPendingOrganizeLabelButton: z.boolean().optional(),
  titleModelAlias: z.string().optional(),
  summaryModelAlias: z.string().optional(),
  darkMode: z.enum(["dark", "system"]).optional(),
  inviteCodeRequired: z.boolean().optional(),
  inviteCode: z.string().optional(),
  searchEngine: z.string().optional(),
  searchSourcesCollapsed: z.boolean().optional(),
  searchProviderConfigs: z.record(z.any()).optional(),
});

// ── Provider schemas ──

const providerPayloadSchema = z.object({
  slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/, "slug 仅允许小写字母、数字、下划线和连字符。"),
  name: z.string().trim().min(1).max(128),
  providerType: z.string(),
  baseURL: z.string().optional(),
  apiKeySource: z.enum(["env", "stored"]).optional(),
  apiKeyEnvName: z.string().optional(),
  apiKeyEncrypted: z.string().optional(),
  apiKey: z.string().optional(),
  systemPromptRole: z.string().optional(),
  requestOptions: z.record(z.unknown()).optional(),
  shared: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const providerCreateSchema = providerPayloadSchema;

export const providerUpdateSchema = providerPayloadSchema.partial({
  slug: true,
  name: true,
  providerType: true,
}).extend({
  slug: z.string().trim().max(64).regex(/^[a-z0-9_-]+$/).optional(),
});

// ── Model schemas ──

const modelPayloadSchema = z.object({
  alias: z.string().trim().optional(),
  label: z.string().optional(),
  providerId: z.string().uuid().optional(),
  providerType: z.string().optional(),
  baseURL: z.string().optional(),
  apiKeySource: z.enum(["env", "stored"]).optional(),
  apiKeyEnvName: z.string().optional(),
  apiKeyEncrypted: z.string().optional(),
  apiKey: z.string().optional(),
  modelName: z.string().trim(),
  enabled: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsSystemRole: z.boolean().optional(),
  supportsMultimodal: z.boolean().optional(),
  supportsToolUse: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  thinkingDisable: z.any().optional(),
  systemPromptRole: z.string().optional(),
  requestOptions: z.record(z.unknown()).optional(),
  isPreset: z.boolean().optional(),
  shared: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const modelCreateSchema = modelPayloadSchema;

export const modelUpdateSchema = modelPayloadSchema.partial({
  alias: true,
  providerType: true,
  modelName: true,
});

export const attachmentUploadSchema = z.object({
  sessionHash: z.string().min(1, "sessionHash 不能为空。"),
  fileName: z.string().optional(),
  mimeType: z.string().min(1, "mimeType 不能为空。"),
  base64Data: z.string().min(1, "base64Data 不能为空。"),
});

const promptContentBlock = z.object({
  type: z.enum(["text", "image_url", "image_attachment", "document_attachment"]),
  text: z.string().optional(),
  image_url: z.object({ url: z.string() }).optional(),
  attachmentId: z.string().optional(),
});

const promptUnion = z.union([
  z.string().min(1),
  z.array(promptContentBlock).min(1),
]);

export const blockReplySchema = z.object({
  sessionHash: z.string().min(1, "sessionHash 不能为空。"),
  prompt: promptUnion,
  modelAlias: z.string().optional(),
  searchMode: z.enum(["auto", "on", "off"]).optional(),
  searchEngine: z.string().optional(),
});

export const blockReplyStreamSchema = blockReplySchema;

export const blockBranchSchema = z.object({
  sessionHash: z.string().min(1, "sessionHash 不能为空。"),
});

export const blockRegenerateSchema = z.object({
  sessionHash: z.string().min(1, "sessionHash 不能为空。"),
  modelAlias: z.string().optional(),
  searchMode: z.enum(["auto", "on", "off"]).optional(),
  searchEngine: z.string().optional(),
});

export const sessionUpdateSchema = z.object({
  title: z.string().trim().min(1, "session title 不能为空。"),
});

export const sessionRegenerateTitleSchema = z.object({
  mode: z.enum(["default", "important"]).optional(),
  useChain: z.boolean().optional(),
});

export const sessionViewStateSchema = z.object({
  mode: z.string().optional(),
  focusedBlockSHA1: z.string().nullable().optional(),
});

export const sessionFocusedBlockSchema = z.object({
  focusedBlockSHA1: z.string().min(1, "focusedBlockSHA1 不能为空。"),
});

export const sessionActiveBlockSchema = z.object({
  blockSHA1: z.string().min(1, "blockSHA1 不能为空。"),
  focusedBlockSHA1: z.string().optional(),
});

export const blockAdaptationUpsertSchema = z.object({
  enabled: z.boolean().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const blockAdaptationRunSchema = z.object({
  modelAlias: z.string().optional(),
});

export const summaryUpdateSchema = z.object({
  status: z.string().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  modelAlias: z.string().optional(),
});

export const summaryGenerateSchema = z.object({
  modelAlias: z.string().optional(),
});

const sha1Hex = z.string().regex(/^[a-f0-9]{40}$/);
const sessionHashHex = z.string().regex(/^[a-f0-9]{24}$/);

export const pathSessionHashSchema = z.object({
  sessionHash: sessionHashHex,
});

export const pathBlockSHA1Schema = z.object({
  blockSHA1: sha1Hex,
});

export const pathModelAliasSchema = z.object({
  alias: z.string().min(1),
});

export const pathProviderIdSchema = z.object({
  providerId: z.string().uuid(),
});

export const pathAdaptationKeySchema = z.object({
  key: z.string().min(1),
});

export const pathAttachmentIdSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
