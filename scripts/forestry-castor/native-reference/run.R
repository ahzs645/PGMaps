#!/usr/bin/env Rscript
# Execute the unchanged, checksum-pinned modules with the real SpaDES event queue.
# No SQL/growth/harvest implementation is copied into this harness.
# Packages are provisioned separately by install.R, never by the simulation.
options(spades.useRequire = FALSE, spades.saveSimOnExit = FALSE, Require.install = FALSE,
        Require.RPackageCache = tempfile("castor-require-cache-"))
suppressPackageStartupMessages({
  library(SpaDES.core)
  library(RSQLite)
  library(data.table)
  library(dplyr)
  library(terra)
  library(jsonlite)
})
args <- commandArgs(trailingOnly = TRUE)
root <- normalizePath(if (length(args)) args[[1]] else ".")
out <- if (length(args) > 1) args[[2]] else file.path(root, "scripts/forestry-castor/native-reference/native-output.json")
source_dir <- file.path(root, "scripts/forestry-castor/reference")
fixture <- fromJSON(file.path(root, "scripts/forestry-castor/native-reference/cases.json"), simplifyVector = FALSE)
expected_hashes <- c(
  "upstream-forestryCastor.R" = "a670ff8fc86ff88082bf1b6d7437760f4415439903c65da0f9e64e5459d034c8",
  "upstream-growingStockCastor.R" = "48d9cd4cf1e2134f834ec18bb02be208f3e0e10c8698f0dba5f8438d9c739e67"
)
for (name in names(expected_hashes)) {
  actual <- digest::digest(file = file.path(source_dir, name), algo = "sha256")
  if (!identical(actual, expected_hashes[[name]])) stop("Upstream source checksum mismatch: ", name)
}
# Keep the upstream files byte-for-byte intact, including their module metadata.
work <- tempfile("castor-native-")
dir.create(work)
module_dir <- file.path(work, "modules")
dir.create(module_dir)
for (name in c("growingStockCastor", "forestryCastor")) {
  dir.create(file.path(module_dir, name))
  file.copy(file.path(source_dir, paste0("upstream-", name, ".R")),
            file.path(module_dir, name, paste0(name, ".R")))
}
# A read-only observer participates in the actual SpaDES queue. It captures both
# sides of harvest and the initial condition, without changing module functions.
dir.create(file.path(module_dir, "nativeObserver"))
writeLines(c(
  'defineModule(sim, list(name = "nativeObserver", description = "Read-only native comparison observer",',
  '  keywords = "validation", authors = person("PGMaps", role = c("aut", "cre"), email = "noreply@example.com"),',
  '  version = list(nativeObserver = "1.0.0"), timeunit = "year",',
  '  parameters = NULL, inputObjects = NULL, outputObjects = NULL))',
  'doEvent.nativeObserver <- function(sim, eventTime, eventType) {',
  '  if (eventType == "init") {',
  '    sim$nativeSnapshots <- list()',
  '    sim <- scheduleEvent(sim, 0, "nativeObserver", "initial", 99)',
  '    for (period in seq_len(end(sim))) {',
  '      sim <- scheduleEvent(sim, period, "nativeObserver", "before", 2)',
  '      sim <- scheduleEvent(sim, period, "nativeObserver", "after", 99)',
  '    }',
  '  } else {',
  '    sim$nativeSnapshots[[length(sim$nativeSnapshots) + 1L]] <- list(',
  '      period = as.integer(time(sim)), phase = eventType,',
  '      pixels = dbGetQuery(sim$castordb, "SELECT pixelid, age, vol, height, eca, yieldid, zone_const, salvage_vol, crownclosure, basalarea, qmd FROM pixels ORDER BY pixelid"),',
  '      harvested = if (eventType == "after") sim$harvestPixelList else NULL,',
  '      landings = if (eventType == "after") I(as.numeric(sim$landings)) else NULL,',
  '      harvestYear = I(as.numeric(sim$harvestBlocks[])),',
  '      harvestVolumeM3 = I(as.numeric(sim$harvestBlocksVolume[])),',
  '      constraintPeriods = I(as.numeric(sim$ras.zoneConstraint[])))',
  '  }',
  '  invisible(sim)',
  '}'
), file.path(module_dir, "nativeObserver/nativeObserver.R"))
rows <- function(x) if (length(x)) rbindlist(lapply(x, as.data.table), fill = TRUE) else data.table()
run_case <- function(case) {
  case <- c(fixture$base[setdiff(names(fixture$base), names(case))], case)
  message("Native case: ", case$id)
  db <- dbConnect(SQLite(), ":memory:")
  on.exit(dbDisconnect(db), add = TRUE)
  pixels <- rows(case$pixels)
  pixels[, zone_const := 0L]
  dbWriteTable(db, "pixels", pixels)
  dbExecute(db, "CREATE INDEX index_age ON pixels(age)")
  dbWriteTable(db, "yields", rows(case$yields))
  dbWriteTable(db, "zone", data.frame(zone_column = "zone1", reference_zone = "fixture"))
  dbExecute(db, "CREATE TABLE zoneConstraints (id integer, zoneid integer, reference_zone text, zone_column text, variable text, threshold numeric, type text, percentage numeric, denom text, multi_condition text, t_area numeric, start integer, stop integer)")
  if (length(case$constraints)) {
    constraints <- rows(case$constraints)
    for (name in c("denom", "multi_condition")) if (!name %in% names(constraints)) constraints[, (name) := NA_character_]
    dbWriteTable(db, "zoneConstraints", as.data.frame(constraints), append = TRUE)
  }
  dbExecute(db, "CREATE TABLE silvSystem (silvsystem integer, entry_var text, entry_req numeric, transition_silv integer, reset_age integer, start integer, stop integer)")
  dbExecute(db, "CREATE TABLE transitions (yieldid_from integer, yieldid_to integer)")
  dbExecute(db, "CREATE VIEW blocks AS SELECT blockid, avg(age) age, avg(height) height, avg(dist) dist, avg(vol*thlb) vol, min(pixelid) landing FROM pixels GROUP BY blockid")
  dbExecute(db, "CREATE TABLE adjacentBlocks (blockid integer, adjblockid integer)")
  ras <- rast(nrows = 1, ncols = nrow(pixels), xmin = 0, xmax = 100*nrow(pixels), ymin = 0, ymax = 100, crs = "EPSG:3005")
  values(ras) <- 0
  flow <- if (length(case$flows)) rows(case$flows) else data.table(compartment = "A", period = 1L, flow = 0, partition = "age >= 20", partition_type = "live")
  objects <- list(castordb = db, scenario = data.table(name = case$id, description = "Synthetic shared-input comparison"),
    boundaryInfo = list("fixture", "id", list("fixture"), "geom"), extent = list(), dbCreds = list(),
    ras = ras, pts = data.table(), harvestFlow = flow)
  if (length(case$schedule)) {
    layers <- lapply(seq_len(case$periods), function(period) {
      r <- ras
      for (entry in case$schedule) if (entry$period == period) r[entry$pixelid] <- pixels[pixelid == entry$pixelid, blockid]
      names(r) <- paste0("hsq_", period*case$stepYears)
      r
    })
    objects$harvestSchedule <- rast(layers)
  }
  paths <- list(modulePath = module_dir, inputPath = work, outputPath = work, cachePath = file.path(work, "cache"))
  params <- list(growingStockCastor = list(periodLength = as.integer(case$stepYears), vacuumInterval = 5L, maxYieldAge = 350L),
    forestryCastor = list(activeZoneConstraint = "fixture", harvestBlockPriority = "age DESC"))
  sim <- simInit(times = list(start = 0, end = case$periods, timeunit = "year"), params = params,
    modules = c("growingStockCastor", "forestryCastor", "nativeObserver"), objects = objects, paths = paths)
  sim <- spades(sim, debug = FALSE, .plotInitialTime = NA_real_)
  list(id = case$id, snapshots = sim$nativeSnapshots, harvestReport = sim$harvestReport,
       growingStockReport = sim$growingStockReport, zoneManagement = sim$zoneManagement)
}
oldwd <- getwd()
setwd(work)
results <- lapply(fixture$cases, run_case)
setwd(oldwd)
packages <- c("SpaDES.core", "RSQLite", "data.table", "terra", "raster", "dplyr", "jsonlite", "digest",
  "reproducible", "quickPlot", "Require", "qs", "RcppParallel", "stringfish", "fpCompare")
versions <- setNames(lapply(packages, function(p) as.character(packageVersion(p))), packages)
write_json(list(schema = "castor-native-output-v1", R = as.character(getRversion()), packages = versions,
  sources = as.list(expected_hashes), harnessSha256 = digest::digest(file = file.path(root, "scripts/forestry-castor/native-reference/run.R"), algo = "sha256"), casesSha256 = digest::digest(file = file.path(root, "scripts/forestry-castor/native-reference/cases.json"), algo = "sha256"), cases = results),
  out, pretty = TRUE, auto_unbox = TRUE, digits = NA, na = "null", null = "null")
message("Wrote native evidence: ", out)
