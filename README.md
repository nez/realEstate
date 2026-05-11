# Introduction
This repo is for crawl data from some suumo pages, and save it into `mongodb` for future use.
![Screenshot 2024-03-20 135657](https://github.com/Takusei/realEstate/assets/45616321/84d652c7-fbdd-4a07-b513-50af99debd5e)


# Setup
Copy the env templates and fill in real credentials. Both files are gitignored.
```
cp .env.example .env
cp scraper/.env.example scraper/.env
# edit both to set MONGO_INITDB_ROOT_PASSWORD / MONGO_URI
```

# Deploy
## How to run this in docker?
```
docker compose down --volumes && docker compose up --build -d
```

## How to run this on k3s?
```
# Build the image
docker build -f ./scraper/docker/Dockerfile -t suumo-scraper:latest ./scraper/. --no-cache

# Import into k3s' containerd (replace `minikube image load` if migrating from minikube)
docker save suumo-scraper:latest | sudo k3s ctr images import -

# Create the namespace and secret (see secret.example.yaml for the shape)
kubectl create namespace realestate
kubectl create secret generic mongodb-creds -n realestate \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=admin \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD='<rotated-password>' \
  --from-literal=MONGO_INITDB_DATABASE=suumo \
  --from-literal=MONGO_URI='mongodb://admin:<rotated-password>@mongodb.realestate.svc.cluster.local:27017/?authSource=admin'

# Apply the manifest (creates the mongodb Deployment and two CronJobs)
kubectl apply -f deployment.yaml

# Verify
kubectl -n realestate get all

# Access mongodb from your host
kubectl -n realestate port-forward deployments/mongodb 27017:27017
```

## Tips
```
# Remove all build volumes and containers
docker rm -vf $(docker ps -aq)

# Remove all built images
docker rmi -f $(docker images -aq)
```

# Access
Connect to mongodb with the URI from your `.env` (`mongodb://<user>:<password>@localhost:27017/suumo?authSource=admin`).

## Querying for cheap listings
After at least one detail crawl has succeeded, query from the `scraper/` directory:

```
# Cheapest 20 by ¥/m² (default sort)
bun run query listings

# Sub-50M¥ in Chiyoda, ≥40m², 20 cheapest by ¥/m²
bun run query listings --max-sale 50000000 --address 千代田 --min-size 40

# Recent price drops in the last 7 days
bun run query changes --kind price_drop --since 7d

# JSON output for piping into jq/duckdb/whatever
bun run query listings --max-sale 50000000 --format json | jq '.[].url'
```

The CLI reads `MONGO_URI` from `scraper/.env`. For local development this is usually `localhost`; in docker / k3s it's `mongodb` / `mongodb.realestate.svc.cluster.local`.

## Mongo URI host by environment
```
local: localhost
docker: host.docker.internal or mongodb (using the service name in docker compose)
k3s:    mongodb.realestate.svc.cluster.local
```
