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

## How to run this in k8s?
Before run this command below, please make sure the necessary is already built in local
```
# Build the image in local
docker build -f ./scraper/docker/Dockerfile -t suumo-scraper:latest ./scraper/. --no-cache

# Load image to minikube if you are using it
minikube image load suumo-scraper

# Create the namespace and secret (see secret.example.yaml for the shape)
kubectl create namespace realestate
kubectl create secret generic mongodb-creds -n realestate \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=admin \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD='<rotated-password>' \
  --from-literal=MONGO_INITDB_DATABASE=suumo \
  --from-literal=MONGO_URI='mongodb://admin:<rotated-password>@mongodb.realestate.svc.cluster.local:27017/?authSource=admin'

# Apply the manifest
kubectl apply -f deployment.yaml

# Verify it has been deployed
kubectl -n realestate get all

# Check mongodb data
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

## Note
For local, docker, k8s, we have to give MONGO_URI different string to get mongodb rui:
```
local: localhost
docker: host.docker.internal or mongodb (using the service name in docker compose)
k9s: mongodb.realestate.svc.cluster.local
```
