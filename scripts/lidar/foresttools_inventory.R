# Bounded, reproducible ForestTools comparison over buffered native CHM cores.
args <- commandArgs(trailingOnly=TRUE)
library(terra)
library(sf)
library(ForestTools)
library(jsonlite)
terraOptions(progress=0)
options(warn=1)
config <- fromJSON(args[1], simplifyVector=FALSE)
chm <- rast(config$height)
variants <- list(list(id='foresttools-fine',slope=.04,intercept=.5),list(id='foresttools-base',slope=.06,intercept=.5),list(id='foresttools-coarse',slope=.10,intercept=.5))
metadata <- list(version=as.character(packageVersion('ForestTools')), variants=variants, runs=list())
for (tile in config$tiles) {
  core <- ext(unlist(tile$bounds)) # xmin,xmax,ymin,ymax
  buffered <- crop(chm, ext(xmin(core)-16,xmax(core)+16,ymin(core)-16,ymax(core)+16),snap='out')
  for (v in variants) {
    started <- proc.time()[3]
    tops <- vwf(buffered,winFun=function(h) h*v$slope+v$intercept,minHeight=5)
    seg <- mcws(tops,buffered,minHeight=2,format='raster')
    # glcm returns actual segment texture, not point-height standard deviation.
    tex <- glcm(buffered,seg,n_grey=32,angle=c(0,1),discretize_range=c(0,60))
    tex$treeID <- rownames(tex)
    write.csv(tex,file.path(config$output,paste0(tile$id,'-',v$id,'-texture.csv')),row.names=FALSE)
    crowns <- mcws(tops,buffered,minHeight=2,format='polygons')
    xy <- st_coordinates(tops)
    own <- xy[,1]>=xmin(core)&xy[,1]<xmax(core)&xy[,2]>=ymin(core)&xy[,2]<ymax(core)
    tops <- tops[own,]
    crowns <- crowns[crowns$treeID %in% tops$treeID,]
    # Whole outlines retained; exported area is the observed buffered crown.
    crowns$treeID <- as.character(crowns$treeID)
    tops$treeID <- as.character(tops$treeID)
    prefix <- file.path(config$output,paste0(tile$id,'-',v$id))
    st_write(tops,paste0(prefix,'-tops.geojson'),quiet=TRUE,delete_dsn=TRUE)
    st_write(crowns,paste0(prefix,'-crowns.geojson'),quiet=TRUE,delete_dsn=TRUE)
    metadata$runs[[length(metadata$runs)+1]] <- list(chunk=tile$id,variant=v$id,treetops=nrow(tops),crowns=nrow(crowns),seconds=unname(proc.time()[3]-started),raster_labels=length(na.omit(unique(values(seg)))))
    cat(tile$id,v$id,nrow(tops),'tops',nrow(crowns),'crowns\n')
  }
}
write_json(metadata,file.path(config$output,'foresttools-run.json'),auto_unbox=TRUE,pretty=TRUE)
