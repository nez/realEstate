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
  const collectCells = (selector: string): void => {
    item.querySelectorAll(selector).forEach((row: Element) => {
      row.querySelectorAll('td').forEach((cell: Element) => {
        tableInfo.push((cell.textContent ?? '').trim().replace(/\s+/g, ' '))
      })
    })
  }
  collectCells('.infodatabox-boxgroup .listtable:nth-of-type(1) tbody tr')
  collectCells('.infodatabox-boxgroup .listtable:nth-of-type(2) tbody tr')
  return tableInfo
}

const getItemDetails = (item: Element): ItemInfo => {
  const category = safeQuerySelector(item, '.cassettebox-header .cassettebox-hpct')
  const name = safeQuerySelector(item, '.cassettebox-header .cassettebox-title a')
  const description = safeQuerySelector(item, '.infodatabox-lead')
  const url = safeGetAttribute(item, '.cassettebox-header .cassettebox-title a', 'href')
  const image = safeGetAttribute(item, '.cassettebox-body .ui-media .infodatabox-object img', 'rel')

  // Use Suumo's nc_<id> as the stable primary key so listings and details can be joined on it.
  const idMatch = url.match(/nc_(\d+)/)
  const id = idMatch ? idMatch[1] : url

  const tableInfo = getInfoFromTable(item)
  const address = tableInfo[0] ?? ''
  const station = tableInfo[1] ? `${tableInfo[1]} ${tableInfo[2] ?? ''}`.trim() : ''
  const price = tableInfo[3] ?? ''
  const size = tableInfo[4] ?? ''
  const age = tableInfo[5] ?? ''

  const { salePriceYen, rentPriceYen } = extractPrice(price)
  const sizeM2 = parseSquareMeters(size)

  return new ItemInfo(id, category, name, address, station, description, image, url, price, size, age, salePriceYen, rentPriceYen, sizeM2)
}

export default getItemDetails
