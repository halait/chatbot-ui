export function createForm(schema: any, values: any = {}, level: number = 0): HTMLElement {
  if (schema.type !== 'object') {
    throw new Error('Only object schema is supported')
  }
  const container = document.createElement('div')
  container.classList.add('schema-form-container')
  if (schema.title) {
    const title = document.createElement(`h${Math.min(6, level + 3)}`)
    title.textContent = schema.title
    container.appendChild(title)
  }
  for (const key of Object.keys(schema.properties)) {
    const item = schema.properties[key]
    let label
    let input
    if (item.type === 'object') {
      input = createForm(item, values[key])
    } else if (item.enum) {
      label = document.createElement('label')
      label.textContent = key
      label.setAttribute('for', `set-${key}-input`)
      input = document.createElement('select')
      input.id = `set-${key}-input`
      const option = document.createElement('option')
      option.value = ''
      input.appendChild(option)
      for (const optionValue of item.enum) {
        const option = document.createElement('option')
        option.value = optionValue
        option.textContent = optionValue
        input.appendChild(option)
        if (values[key] && values[key] === optionValue) {
          option.selected = true
        } else if (item.default && item.default === optionValue) {
          option.selected = true
        }
      }
    } else {
      label = document.createElement('label')
      label.textContent = key
      label.setAttribute('for', `set-${key}-input`)
      input = document.createElement('input')
      input.id = `set-${key}-input`
      switch (item.type) {
        case 'number':
          input.type = 'number'
          if (values[key] !== undefined) {
            input.value = values[key]
          } else if (item.default !== undefined) {
            input.value = item.default
          }
          break
        case 'boolean':
          input.type = 'checkbox'
          if (values[key] !== undefined) {
            input.checked = values[key]
          } else if (item.default !== undefined) {
            input.checked = item.default
          }
          break
        default:
          if(item.format === 'password') input.type = 'password'
          else input.type = 'text'
          if (values[key] !== undefined) {
            input.value = values[key]
          } else if (item.default !== undefined) {
            input.value = item.default
          }
      }
    }
    input.dataset.key = key
    if (label) container.appendChild(label)
    container.appendChild(input)
  }
  return container
}

export function getFormValues(container: HTMLElement): any {
  const values: any = {}
  const inputs = container.children as HTMLCollectionOf<HTMLElement>
  for(const input of inputs) {
    const key = input.dataset?.key
    if (key) {
      if(input.classList.contains('schema-form-container')) {
        let nested = getFormValues(input)
        if(Object.keys(nested).length !== 0) values[key] = nested
      } else if ((input as HTMLInputElement).type === 'checkbox') {
        values[key] = (input as HTMLInputElement).checked
      } else if ((input as HTMLInputElement).value){
        values[key] = (input as HTMLInputElement).value
        if((input as HTMLInputElement).type === 'number') {
          values[key] = Number(values[key])
        }
      }
    }
  }
  return values
}
