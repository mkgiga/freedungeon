
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

export type SchemaField = {
    path: string[]
    label: string
    description?: string
    default: any
    control: Control
}

export type PrimitiveType = 'number' | 'string' | 'boolean' | 'array' | 'object'

export type PrimitiveRendererProps = {
    control: Control
    field: SchemaField
    value: any
    onChange: (value: any) => void
}

export type PrimitiveRendererFn = (props: PrimitiveRendererProps) => any

export type SchemaFormHooks = {
    renderPrimitive?: Partial<Record<PrimitiveType, PrimitiveRendererFn>>

    editable?: boolean

    disabled?: boolean

    onSchemaChange?: (fields: SchemaField[]) => void

    onFieldMount?: (field: SchemaField, value: any) => void

    onFieldChange?: (field: SchemaField, oldValue: any, newValue: any) => void

    onFormMount?: () => void

    onBeforeSerialize?: (values: Record<string, any>) => Record<string, any>
}
