import { MongoClient } from 'mongodb'
import { config } from './config'

const client = new MongoClient(config().mongo.uri)

export default client
