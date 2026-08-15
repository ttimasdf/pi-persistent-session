import { Type, type Static } from "typebox";
import Value from "typebox/value";

export const SessionNamespacePolicySchema = Type.Union([
	Type.Literal("auto"),
	Type.Literal("prompt"),
	Type.Literal("never"),
]);

export const RelocationPolicySchema = Type.Union([
	Type.Literal("auto"),
	Type.Literal("prompt"),
	Type.Literal("warn"),
]);

const StoredSettingsSchema = Type.Object(
	{
		sessionNamespacePolicy: Type.Optional(SessionNamespacePolicySchema),
		relocationPolicy: Type.Optional(RelocationPolicySchema),
		removeOriginalSessions: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const PersistentSessionConfigSchema = Type.Object(
	{
		version: Type.Literal(1),
		settings: StoredSettingsSchema,
	},
	{ additionalProperties: false },
);

export const WorkspaceIdentitySchema = Type.Object(
	{
		version: Type.Literal(1),
		sessionNamespaceId: Type.String({
			minLength: 1,
			pattern: "^(?!\\.{1,2}$)[^/\\\\]+$",
		}),
		observedCwd: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export type SessionNamespacePolicy = Static<
	typeof SessionNamespacePolicySchema
>;
export type RelocationPolicy = Static<typeof RelocationPolicySchema>;
export type PersistentSessionSettings = Required<
	Static<typeof StoredSettingsSchema>
>;
export type PersistentSessionConfig = Omit<
	Static<typeof PersistentSessionConfigSchema>,
	"settings"
> & { settings: PersistentSessionSettings };
export type WorkspaceIdentity = Static<typeof WorkspaceIdentitySchema>;

export const DEFAULT_SETTINGS: Readonly<PersistentSessionSettings> = {
	sessionNamespacePolicy: "prompt",
	relocationPolicy: "prompt",
	removeOriginalSessions: false,
};

export function parsePersistentSessionConfig(
	value: unknown,
): PersistentSessionConfig {
	const parsed = Value.Parse(PersistentSessionConfigSchema, value);
	return {
		version: 1,
		settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
	};
}

export function parseWorkspaceIdentity(value: unknown): WorkspaceIdentity {
	return Value.Parse(WorkspaceIdentitySchema, value);
}
