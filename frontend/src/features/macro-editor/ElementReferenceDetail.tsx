import type {
  ScreenElementParamSchema,
  ScreenElementReference,
} from './screen-elements'

const MISSING_DESCRIPTION = '설명이 아직 등록되지 않았습니다.'

export function ElementReferenceDetail({ reference }: { reference: ScreenElementReference }) {
  const { screen, category, element } = reference
  const signature = element.requiredParams.length > 0
    ? `${element.id}[${element.requiredParams.join(', ')}]`
    : element.id
  return (
    <article className="element-reference-detail" aria-label={`${element.label} 상세 설명`}>
      <header>
        <p>{screen.label} / {category.label}</p>
        <h2>{element.label}</h2>
        <code>{signature}</code>
      </header>

      <dl className="element-reference-facts">
        <Fact label="Label" value={element.label} />
        <Fact label="Screen" value={screen.id} code />
        <Fact label="Category" value={category.label} />
        <Fact label="Semantic ID" value={element.id} code />
        <Fact label="역할" value={element.role ?? '등록되지 않음'} />
        <Fact
          label="종류"
          value={element.kind ?? (element.requiredParams.length > 0 ? 'collection' : 'element')}
          code
        />
        <Fact label="반환 타입" value={returnTypeLabel(element.returnType)} code />
      </dl>

      <section>
        <h3>설명</h3>
        <p>{element.description ?? MISSING_DESCRIPTION}</p>
      </section>

      <section>
        <h3>Required params</h3>
        {element.requiredParams.length === 0 ? (
          <p className="element-reference-muted">필수 파라미터가 없습니다.</p>
        ) : (
          <div className="element-reference-params">
            {element.requiredParams.map((name) => {
              const schema = element.params[name]
              return schema
                ? <ParamReference key={name} name={name} schema={schema} />
                : <p key={name}><code>{name}</code> 스키마가 등록되지 않았습니다.</p>
            })}
          </div>
        )}
      </section>

      <section>
        <h3>상태 metadata</h3>
        {Object.keys(element.stateMetadata).length === 0 ? (
          <p className="element-reference-muted">등록된 상태 metadata가 없습니다.</p>
        ) : (
          <dl className="element-reference-metadata">
            {Object.entries(element.stateMetadata).map(([name, description]) => (
              <div key={name}><dt><code>{name}</code></dt><dd>{description}</dd></div>
            ))}
          </dl>
        )}
      </section>

      <section>
        <h3>사용 예</h3>
        {element.usage.length === 0 ? (
          <p className="element-reference-muted">등록된 사용 예가 없습니다.</p>
        ) : (
          <ul>{element.usage.map((usage) => <li key={usage}>{usage}</li>)}</ul>
        )}
      </section>
    </article>
  )
}

function Fact({
  label,
  value,
  code = false,
}: {
  label: string
  value: string
  code?: boolean
}) {
  return <div><dt>{label}</dt><dd>{code ? <code>{value}</code> : value}</dd></div>
}

function ParamReference({ name, schema }: { name: string; schema: ScreenElementParamSchema }) {
  return (
    <article className="element-reference-param">
      <header><strong>{schema.label}</strong><code>{name}: {schema.type}</code></header>
      <p>{schema.description ?? MISSING_DESCRIPTION}</p>
      <dl>
        <Fact label="기본값" value={displayValue(schema.default)} code />
        <Fact label="허용 범위/선택지" value={allowedValues(schema)} code />
      </dl>
      {schema.valueHint && <p className="element-reference-param__hint">{schema.valueHint}</p>}
    </article>
  )
}

function displayValue(value: unknown): string {
  if (value === undefined) return '없음'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function allowedValues(schema: ScreenElementParamSchema): string {
  if (schema.options && schema.options.length > 0) {
    if (schema.options.length > 8) {
      return `${schema.options[0]!.label} ~ ${schema.options.at(-1)!.label} (${schema.options.length}개)`
    }
    return schema.options.map((option) => option.label).join(', ')
  }
  if (schema.min !== undefined || schema.max !== undefined) {
    return `${schema.min ?? '-∞'} ~ ${schema.max ?? '∞'}`
  }
  return '제한 없음'
}

function returnTypeLabel(value: string | undefined): string {
  if (!value) return '등록되지 않음'
  return value === 'element' ? 'Element' : value
}
