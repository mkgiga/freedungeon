// ── Control Types ──

export type SliderControl = {
    type: 'slider'
    min: number
    max: number
    step: number
}

export type NumberControl = {
    type: 'number'
    min?: number
    max?: number
    step?: number
}

export type SelectControl = {
    type: 'select'
    options: { label: string; value: any }[]
}

export type ToggleControl = {
    type: 'toggle'
}

export type TextControl = {
    type: 'text'
    multiline?: boolean
    maxLength?: number
}

export type TagsControl = {
    type: 'tags'
    maxItems?: number
}

export type ArrayControl = {
    type: 'array'
    item: SchemaField
    minItems?: number
    maxItems?: number
}

export type GroupControl = {
    type: 'group'
    fields: SchemaField[]
}

export type FlexRowControl = {
    type: 'flex-row'
    gap?: number
    fields: SchemaField[]
}

export type FlexColControl = {
    type: 'flex-col'
    gap?: number
    fields: SchemaField[]
}

export type SectionControl = {
    type: 'section'
    collapsible?: boolean
    defaultOpen?: boolean
    fields: SchemaField[]
}

export type Control =
    | SliderControl
    | NumberControl
    | SelectControl
    | ToggleControl
    | TextControl
    | TagsControl
    | ArrayControl
    | GroupControl
    | FlexRowControl
    | FlexColControl
    | SectionControl

// ── Schema Field ──

export type SchemaField = {
    path: string[]
    label: string
    description?: string
    default: any
    control: Control
}

// ── Primitive Types ──

export type PrimitiveType = 'number' | 'string' | 'boolean' | 'array' | 'object'

// ── Renderer Props ──

export type PrimitiveRendererProps = {
    control: Control
    field: SchemaField
    value: any
    onChange: (value: any) => void
}

export type PrimitiveRendererFn = (props: PrimitiveRendererProps) => any

// ── Hooks ──

export type SchemaFormHooks = {
    /** Override how a primitive type renders. Receives the control config for customization. */
    renderPrimitive?: Partial<Record<PrimitiveType, PrimitiveRendererFn>>

    /** When true, fields show schema editors (min/max/step/options) instead of value inputs */
    editable?: boolean

    /** When true, all controls are read-only */
    disabled?: boolean

    /** Called when a field's schema definition changes (only in editable mode) */
    onSchemaChange?: (fields: SchemaField[]) => void

    /** Called when a field is first mounted */
    onFieldMount?: (field: SchemaField, value: any) => void

    /** Called when a field value changes, before onChange propagates */
    onFieldChange?: (field: SchemaField, oldValue: any, newValue: any) => void

    /** Called after all fields are mounted */
    onFormMount?: () => void

    /** Called before buildRequestBody serializes */
    onBeforeSerialize?: (values: Record<string, any>) => Record<string, any>
}
