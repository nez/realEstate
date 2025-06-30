import ItemInfo from './itemInfo'
import { extractPrice, parseSquareMeters } from './parserUtils'

const safeQuerySelector = (item: Element, selector: string): string => {
  return item.querySelector(selector)?.textContent?.trim() ?? ''
}

const safeGetAttribute = (item: Element, selector: string, attribute: string): string => {
  return item.querySelector(selector)?.getAttribute(attribute) ?? ''
}

const getInfoFromTable = (item: Element): string[] => {
  const tableInfo: string[] = []
  // This part is less critical to make safe as it's a specific sub-parser
  const firstTableRows = item.querySelectorAll('.infodatabox-boxgroup .listtable:nth-of-type(1) tbody tr')
  firstTableRows.forEach((row: any) => {
    const cells = row.querySelectorAll('td')
    cells.forEach((cell: HTMLElement) => {
      tableInfo.push((cell?.textContent ?? '').trim().replace(/\s+/g, ' '))
    })
  })

  const secondTableRows = item.querySelectorAll('.infodatabox-boxgroup .listtable:nth-of-type(2) tbody tr')
  secondTableRows.forEach((row: any) => {
    const cells = row.querySelectorAll('td')
    cells.forEach((cell: HTMLElement) => {
      tableInfo.push((cell?.textContent ?? '').trim().replace(/\s+/g, ' '))
    })
  })
  return tableInfo
}

const getItemDetails = (item: Element): ItemInfo => {
  const category = safeQuerySelector(item, '.cassettebox-header .cassettebox-hpct')
  const name = safeQuerySelector(item, '.cassettebox-header .cassettebox-title a')
  const description = safeQuerySelector(item, '.infodatabox-lead')
  const url = safeGetAttribute(item, '.cassettebox-header .cassettebox-title a', 'href')
  const image = safeGetAttribute(item, '.cassettebox-body .ui-media .infodatabox-object img', 'rel')

  const tableInfo = getInfoFromTable(item)
  const address = tableInfo[0] ?? ''
  const station = tableInfo[1] ? `${tableInfo[1]} ${tableInfo[2] ?? ''}`.trim() : ''
  const price = tableInfo[3] ?? ''
  const size = tableInfo[4] ?? ''
  const age = tableInfo[5] ?? ''

  // Create computed fields
  const { salePriceYen, rentPriceYen } = extractPrice(price)
  const sizeM2 = parseSquareMeters(size)

  return new ItemInfo(url, category, name, address, station, description, image, url, price, size, age, salePriceYen, rentPriceYen, sizeM2)
}

export default getItemDetails
