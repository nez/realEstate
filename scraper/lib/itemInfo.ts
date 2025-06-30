export default class ItemInfo {
  _id: string
  category: string
  name: string
  address: string
  station: string
  description: string
  image: string
  url: string
  price: string
  size: string
  age: string
  updateDate: Date
  salePriceYen: number | null
  rentPriceYen: number | null
  sizeM2: number | null

  constructor (
    _id: string,
    catalog: string,
    name: string,
    address: string,
    station: string,
    description: string,
    image: string,
    url: string,
    price: string,
    size: string,
    age: string,
    salePriceYen: number | null,
    rentPriceYen: number | null,
    sizeM2: number | null
  ) {
    this._id = _id
    this.category = catalog
    this.name = name
    this.address = address
    this.station = station
    this.description = description
    this.image = image
    this.url = process.env.BASE_PATH + url
    this.price = price
    this.size = size
    this.age = age
    this.salePriceYen = salePriceYen
    this.rentPriceYen = rentPriceYen
    this.sizeM2 = sizeM2
    this.updateDate = new Date()
  }
}
