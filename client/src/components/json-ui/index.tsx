import { For, Show, createSignal, onMount, createContext, useContext } from 'solid-js'
import type {
    SchemaField, Control, SchemaFormHooks, PrimitiveType,
    SliderControl, NumberControl, SelectControl,
    TextControl, TagsControl,
    ArrayControl, GroupControl,
    FlexRowControl, FlexColControl, SectionControl,
} from '@shared/schema-ui'
import { Heading } from '../typography/Heading'
import { Text } from '../typography/Text'

// ── Utilities ──

function getByPath(obj: any, path: string[]): any {
    let current = obj
    for (const key of path) {
        if (current == null) return undefined
        current = current[key]
    }
    return current
}

function setByPath(obj: any, path: string[], value: any): any {
    if (path.length === 0) return value
    const result = Array.isArray(obj) ? [...obj] : { ...obj }
    const [head, ...rest] = path
    result[head] = rest.length === 0 ? value : setByPath(result[head] ?? {}, rest, value)
    return result
}

function getPrimitiveType(control: Control): PrimitiveType {
    switch (control.type) {
        case 'slider':
        case 'number':
            return 'number'
        case 'text':
        case 'tags':
        case 'select':
            return 'string'
        case 'toggle':
            return 'boolean'
        case 'array':
            return 'array'
        case 'group':
        case 'flex-row':
        case 'flex-col':
        case 'section':
            return 'object'
    }
}

// ── Context ──

const HooksContext = createContext<SchemaFormHooks>({})

// ── Main Component ──

export function SchemaForm(props: {
    fields: SchemaField[]
    values: Record<string, any>
    onChange: (values: Record<string, any>) => void
    hooks?: SchemaFormHooks
}) {
    const setValue = (field: SchemaField, path: string[], newValue: any) => {
        const oldValue = getByPath(props.values, path)
        props.hooks?.onFieldChange?.(field, oldValue, newValue)
        props.onChange(setByPath(props.values, path, newValue))
    }

    const updateField = (index: number, updated: SchemaField) => {
        const newFields = [...props.fields]
        newFields[index] = updated
        props.hooks?.onSchemaChange?.(newFields)
    }

    onMount(() => props.hooks?.onFormMount?.())

    return (
        <HooksContext.Provider value={props.hooks ?? {}}>
            <div class="schema-form">
                <For each={props.fields}>
                    {(field, i) => (
                        <FieldRenderer
                            field={field}
                            value={getByPath(props.values, field.path) ?? field.default}
                            onChange={(value) => setValue(field, field.path, value)}
                            onFieldUpdate={(updated) => updateField(i(), updated)}
                        />
                    )}
                </For>
            </div>
        </HooksContext.Provider>
    )
}

// ── Field Renderer ──

function FieldRenderer(props: {
    field: SchemaField
    value: any
    onChange: (value: any) => void
    onFieldUpdate?: (updated: SchemaField) => void
}) {
    const hooks = useContext(HooksContext)

    onMount(() => hooks.onFieldMount?.(props.field, props.value))

    // Check for primitive-level override
    const primitiveType = getPrimitiveType(props.field.control)
    const customRenderer = hooks.renderPrimitive?.[primitiveType]

    if (customRenderer) {
        return customRenderer({
            control: props.field.control,
            field: props.field,
            value: props.value,
            onChange: props.onChange,
        })
    }

    return (
        <div class="schema-field">
            <Show when={props.field.control.type !== 'group'}>
                <label class="schema-field-label">
                    <Show when={hooks.editable} fallback={props.field.label}>
                        <input
                            class="schema-field-label-edit"
                            type="text"
                            value={props.field.label}
                            onInput={(e) => props.onFieldUpdate?.({ ...props.field, label: e.currentTarget.value })}
                        />
                    </Show>
                </label>
            </Show>
            <Show when={props.field.description || hooks.editable}>
                <Show when={hooks.editable} fallback={<Text size="sm" class="schema-field-description">{props.field.description}</Text>}>
                    <input
                        class="schema-field-description-edit"
                        type="text"
                        value={props.field.description ?? ''}
                        placeholder="Description..."
                        onInput={(e) => props.onFieldUpdate?.({ ...props.field, description: e.currentTarget.value })}
                    />
                </Show>
            </Show>
            <Show when={hooks.editable}>
                <ControlEditor
                    control={props.field.control}
                    onControlChange={(control) => props.onFieldUpdate?.({ ...props.field, control })}
                />
            </Show>
            <DefaultControlRenderer
                control={props.field.control}
                field={props.field}
                value={props.value}
                onChange={props.onChange}
            />
        </div>
    )
}

// ── Control Editor (edit mode — configure the control itself) ──

function ControlEditor(props: { control: Control; onControlChange: (control: Control) => void }) {
    const update = (patch: Partial<Control>) => {
        props.onControlChange({ ...props.control, ...patch } as Control)
    }

    return (
        <details class="schema-control-editor">
            <summary>Control Settings</summary>
            <div class="schema-control-editor-fields">
                <label>
                    Type
                    <select
                        value={props.control.type}
                        onChange={(e) => {
                            const type = e.currentTarget.value as Control['type']
                            const defaults: Record<string, Control> = {
                                slider: { type: 'slider', min: 0, max: 1, step: 0.1 },
                                number: { type: 'number' },
                                select: { type: 'select', options: [] },
                                toggle: { type: 'toggle' },
                                text: { type: 'text' },
                                tags: { type: 'tags' },
                                array: { type: 'array', item: { path: [], label: 'Item', default: '', control: { type: 'text' } } },
                                group: { type: 'group', fields: [] },
                            }
                            props.onControlChange(defaults[type])
                        }}
                    >
                        <option value="slider">Slider</option>
                        <option value="number">Number</option>
                        <option value="select">Select</option>
                        <option value="toggle">Toggle</option>
                        <option value="text">Text</option>
                        <option value="tags">Tags</option>
                        <option value="array">Array</option>
                        <option value="group">Group</option>
                    </select>
                </label>

                <Show when={props.control.type === 'slider'}>
                    {(() => {
                        const c = props.control as SliderControl
                        return <>
                            <label>Min <input type="number" value={c.min} onInput={(e) => update({ min: Number(e.currentTarget.value) } as any)} /></label>
                            <label>Max <input type="number" value={c.max} onInput={(e) => update({ max: Number(e.currentTarget.value) } as any)} /></label>
                            <label>Step <input type="number" value={c.step} step="0.01" onInput={(e) => update({ step: Number(e.currentTarget.value) } as any)} /></label>
                        </>
                    })()}
                </Show>

                <Show when={props.control.type === 'number'}>
                    {(() => {
                        const c = props.control as NumberControl
                        return <>
                            <label>Min <input type="number" value={c.min ?? ''} onInput={(e) => update({ min: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } as any)} /></label>
                            <label>Max <input type="number" value={c.max ?? ''} onInput={(e) => update({ max: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } as any)} /></label>
                            <label>Step <input type="number" value={c.step ?? ''} step="0.01" onInput={(e) => update({ step: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } as any)} /></label>
                        </>
                    })()}
                </Show>

                <Show when={props.control.type === 'text'}>
                    {(() => {
                        const c = props.control as TextControl
                        return <>
                            <label>Multiline <input type="checkbox" checked={c.multiline ?? false} onChange={(e) => update({ multiline: e.currentTarget.checked } as any)} /></label>
                            <label>Max Length <input type="number" value={c.maxLength ?? ''} onInput={(e) => update({ maxLength: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } as any)} /></label>
                        </>
                    })()}
                </Show>

                <Show when={props.control.type === 'tags'}>
                    {(() => {
                        const c = props.control as TagsControl
                        return <label>Max Items <input type="number" value={c.maxItems ?? ''} onInput={(e) => update({ maxItems: e.currentTarget.value ? Number(e.currentTarget.value) : undefined } as any)} /></label>
                    })()}
                </Show>
            </div>
        </details>
    )
}

// ── Default Control Renderer (built-in hooks for each primitive) ──

function DefaultControlRenderer(props: {
    control: Control
    field: SchemaField
    value: any
    onChange: (value: any) => void
}) {
    switch (props.control.type) {
        case 'slider':
            return <SliderField control={props.control} value={props.value} onChange={props.onChange} />
        case 'number':
            return <NumberField control={props.control} value={props.value} onChange={props.onChange} />
        case 'select':
            return <SelectField control={props.control} value={props.value} onChange={props.onChange} />
        case 'toggle':
            return <ToggleField value={props.value} onChange={props.onChange} />
        case 'text':
            return <TextField control={props.control} value={props.value} onChange={props.onChange} />
        case 'tags':
            return <TagsField control={props.control} value={props.value} onChange={props.onChange} />
        case 'array':
            return <ArrayField control={props.control} field={props.field} value={props.value} onChange={props.onChange} />
        case 'group':
            return <GroupField control={props.control} field={props.field} value={props.value} onChange={props.onChange} />
        case 'flex-row':
            return <FlexRowField control={props.control} field={props.field} value={props.value} onChange={props.onChange} />
        case 'flex-col':
            return <FlexColField control={props.control} field={props.field} value={props.value} onChange={props.onChange} />
        case 'section':
            return <SectionField control={props.control} field={props.field} value={props.value} onChange={props.onChange} />
    }
}

// ── Default Controls (number primitives) ──

function SliderField(props: { control: SliderControl; value: number; onChange: (v: number) => void }) {
    const hooks = useContext(HooksContext)
    return (
        <div class="schema-control schema-slider">
            <input
                type="range"
                min={props.control.min}
                max={props.control.max}
                step={props.control.step}
                value={props.value}
                disabled={hooks.disabled}
                onInput={(e) => props.onChange(Number(e.currentTarget.value))}
            />
            <span class="schema-slider-value">{props.value}</span>
        </div>
    )
}

function NumberField(props: { control: NumberControl; value: number; onChange: (v: number) => void }) {
    const hooks = useContext(HooksContext)
    return (
        <input
            class="schema-control schema-number"
            type="number"
            min={props.control.min}
            max={props.control.max}
            step={props.control.step}
            value={props.value}
            disabled={hooks.disabled}
            onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        />
    )
}

// ── Default Controls (string primitives) ──

function TextField(props: { control: TextControl; value: string; onChange: (v: string) => void }) {
    const hooks = useContext(HooksContext)
    if (props.control.multiline) {
        return (
            <textarea
                class="schema-control schema-textarea"
                maxLength={props.control.maxLength}
                value={props.value}
                disabled={hooks.disabled}
                onInput={(e) => props.onChange(e.currentTarget.value)}
            />
        )
    }
    return (
        <input
            class="schema-control schema-text"
            type="text"
            maxLength={props.control.maxLength}
            value={props.value}
            disabled={hooks.disabled}
            onInput={(e) => props.onChange(e.currentTarget.value)}
        />
    )
}

function SelectField(props: { control: SelectControl; value: any; onChange: (v: any) => void }) {
    const hooks = useContext(HooksContext)
    return (
        <select
            class="schema-control schema-select"
            value={props.value}
            disabled={hooks.disabled}
            onChange={(e) => {
                const option = props.control.options.find(o => String(o.value) === e.currentTarget.value)
                if (option) props.onChange(option.value)
            }}
        >
            <For each={props.control.options}>
                {(option) => (
                    <option value={String(option.value)} selected={option.value === props.value}>
                        {option.label}
                    </option>
                )}
            </For>
        </select>
    )
}

// ── Default Controls (boolean primitive) ──

function ToggleField(props: { value: boolean; onChange: (v: boolean) => void }) {
    const hooks = useContext(HooksContext)
    return (
        <input
            class="schema-control schema-toggle"
            type="checkbox"
            checked={props.value}
            disabled={hooks.disabled}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
    )
}

// ── Default Controls (array primitives) ──

function TagsField(props: { control: TagsControl; value: string[]; onChange: (v: string[]) => void }) {
    const [input, setInput] = createSignal('')

    const addTag = () => {
        const tag = input().trim()
        if (!tag) return
        if (props.control.maxItems && props.value.length >= props.control.maxItems) return
        props.onChange([...props.value, tag])
        setInput('')
    }

    const removeTag = (index: number) => {
        props.onChange(props.value.filter((_, i) => i !== index))
    }

    return (
        <div class="schema-control schema-tags">
            <div class="schema-tags-list">
                <For each={props.value}>
                    {(tag, i) => (
                        <span class="schema-tag">
                            {tag}
                            <button type="button" onClick={() => removeTag(i())}>x</button>
                        </span>
                    )}
                </For>
            </div>
            <Show when={!props.control.maxItems || props.value.length < props.control.maxItems}>
                <input
                    class="schema-tags-input"
                    type="text"
                    value={input()}
                    onInput={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                    placeholder="Add tag..."
                />
            </Show>
        </div>
    )
}

function ArrayField(props: { control: ArrayControl; field: SchemaField; value: any[]; onChange: (v: any[]) => void }) {
    const addItem = () => {
        if (props.control.maxItems && props.value.length >= props.control.maxItems) return
        props.onChange([...props.value, props.control.item.default])
    }

    const removeItem = (index: number) => {
        if (props.control.minItems && props.value.length <= props.control.minItems) return
        props.onChange(props.value.filter((_, i) => i !== index))
    }

    const updateItem = (index: number, value: any) => {
        const updated = [...props.value]
        updated[index] = value
        props.onChange(updated)
    }

    return (
        <div class="schema-control schema-array">
            <For each={props.value}>
                {(item, i) => (
                    <div class="schema-array-item">
                        <FieldRenderer
                            field={{ ...props.control.item, path: [...props.field.path, String(i())] }}
                            value={item}
                            onChange={(v) => updateItem(i(), v)}
                        />
                        <Show when={!props.control.minItems || props.value.length > props.control.minItems}>
                            <button type="button" class="schema-array-remove" onClick={() => removeItem(i())}>Remove</button>
                        </Show>
                    </div>
                )}
            </For>
            <Show when={!props.control.maxItems || props.value.length < props.control.maxItems}>
                <button type="button" class="schema-array-add" onClick={addItem}>Add</button>
            </Show>
        </div>
    )
}

// ── Default Controls (object primitive) ──

function GroupField(props: { control: GroupControl; field: SchemaField; value: any; onChange: (v: any) => void }) {
    return (
        <fieldset class="schema-control schema-group">
            <legend>{props.field.label}</legend>
            <For each={props.control.fields}>
                {(childField) => {
                    // If the child path starts with the parent path, strip it.
                    // Otherwise treat the child path as already relative (e.g. inside array items).
                    const parentLen = props.field.path.length
                    const startsWithParent = childField.path.length > parentLen &&
                        props.field.path.every((p, i) => childField.path[i] === p)
                    const relativePath = startsWithParent
                        ? childField.path.slice(parentLen)
                        : childField.path
                    return (
                        <FieldRenderer
                            field={childField}
                            value={getByPath(props.value, relativePath) ?? childField.default}
                            onChange={(v) => props.onChange(setByPath(props.value ?? {}, relativePath, v))}
                        />
                    )
                }}
            </For>
        </fieldset>
    )
}

// ── Layout Controls ──

function LayoutChildren(props: { fields: SchemaField[]; parentPath: string[]; value: any; onChange: (v: any) => void }) {
    return (
        <For each={props.fields}>
            {(childField) => {
                const parentLen = props.parentPath.length
                const startsWithParent = childField.path.length > parentLen &&
                    props.parentPath.every((p, i) => childField.path[i] === p)
                const relativePath = startsWithParent
                    ? childField.path.slice(parentLen)
                    : childField.path
                return (
                    <FieldRenderer
                        field={childField}
                        value={getByPath(props.value, relativePath) ?? childField.default}
                        onChange={(v) => props.onChange(setByPath(props.value ?? {}, relativePath, v))}
                    />
                )
            }}
        </For>
    )
}

function FlexRowField(props: { control: FlexRowControl; field: SchemaField; value: any; onChange: (v: any) => void }) {
    return (
        <div class="schema-control schema-flex-row" style={{ display: 'flex', "flex-direction": 'row', gap: `${props.control.gap ?? 8}px` }}>
            <LayoutChildren fields={props.control.fields} parentPath={props.field.path} value={props.value} onChange={props.onChange} />
        </div>
    )
}

function FlexColField(props: { control: FlexColControl; field: SchemaField; value: any; onChange: (v: any) => void }) {
    return (
        <div class="schema-control schema-flex-col" style={{ display: 'flex', "flex-direction": 'column', gap: `${props.control.gap ?? 8}px` }}>
            <LayoutChildren fields={props.control.fields} parentPath={props.field.path} value={props.value} onChange={props.onChange} />
        </div>
    )
}

function SectionField(props: { control: SectionControl; field: SchemaField; value: any; onChange: (v: any) => void }) {
    if (props.control.collapsible) {
        return (
            <details class="schema-control schema-section" open={props.control.defaultOpen ?? true}>
                <summary>{props.field.label}</summary>
                <LayoutChildren fields={props.control.fields} parentPath={props.field.path} value={props.value} onChange={props.onChange} />
            </details>
        )
    }
    return (
        <div class="schema-control schema-section">
            <Heading level={3}>{props.field.label}</Heading>
            <LayoutChildren fields={props.control.fields} parentPath={props.field.path} value={props.value} onChange={props.onChange} />
        </div>
    )
}

// ── Serialization ──

export function buildRequestBody(fields: SchemaField[], values: Record<string, any>, hooks?: SchemaFormHooks): Record<string, any> {
    const resolved = hooks?.onBeforeSerialize?.(values) ?? values
    let body: Record<string, any> = {}
    for (const field of fields) {
        const value = getByPath(resolved, field.path)
        if (value !== undefined) {
            body = setByPath(body, field.path, value)
        }
    }
    return body
}
