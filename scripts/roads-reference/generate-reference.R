#!/usr/bin/env Rscript
# Execute the pinned, installed R package. Do not replace these calls with translated formulas.
args <- commandArgs(trailingOnly = TRUE)
cases_path <- if (length(args) >= 1) args[[1]] else "scripts/roads-reference/cases.json"
output_path <- if (length(args) >= 2) args[[2]] else "scripts/roads-reference/output/native-r.json"

required <- c("roads", "jsonlite", "terra", "sf", "igraph", "data.table")
for (package in required) {
  if (!requireNamespace(package, quietly = TRUE)) stop("Missing R package: ", package)
}

cases <- jsonlite::fromJSON(cases_path, simplifyVector = FALSE)
stopifnot(identical(cases$schema, "pgmaps-roads-reference-cases-v1"))
description <- utils::packageDescription("roads")
remote_sha <- description$RemoteSha
if (is.null(remote_sha)) remote_sha <- description$GithubSHA1
# An unrecorded CRAN installation must not pass as a verified checkout of the pinned source.
if (is.null(remote_sha) || !identical(tolower(remote_sha), cases$commit)) {
  stop("The installed roads package does not record the required commit ", cases$commit,
       ". Install github::LandSciTech/roads@", cases$commit, " with pak.")
}
if (!identical(as.character(utils::packageVersion("roads")), cases$version)) {
  stop("The installed roads package version differs from the reference manifest.")
}

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
data.table::setDTthreads(1L)
terra::terraOptions(threads = 1L, parallel = FALSE)

scalar <- function(value) if (is.null(value)) NA_real_ else as.numeric(value)
encode_number <- function(value) {
  stopifnot(length(value) == 1)
  if (is.na(value)) return(list(kind = "missing", value = NULL))
  if (is.infinite(value)) return(list(kind = if (value > 0) "positive-infinity" else "negative-infinity", value = NULL))
  list(kind = "finite", value = as.numeric(value))
}

formulas <- lapply(cases$formulaCases, function(case) {
  arguments <- list(x1 = scalar(case$x1), x2 = scalar(case$x2), hdistance = scalar(case$distance))
  if (!is.null(case$options)) arguments <- c(arguments, lapply(case$options, scalar))
  fn <- switch(case[["function"]],
               simpleCostFn = roads::simpleCostFn,
               gradePenaltyFn = roads::gradePenaltyFn,
               stop("Unknown formula: ", case[["function"]]))
  list(id = case$id, function_name = case[["function"]], result = encode_number(do.call(fn, arguments)))
})

# The fixture and raster extraction are those used by the upstream test suite:
# data-raw/CLUSexample.R and tests/testthat/test-projectRoads_CLUSexample.R.
clus <- roads::prepExData(roads::CLUSexample)
cost <- clus$cost
road_cells <- function(result) {
  lines <- suppressWarnings(sf::st_collection_extract(result$roads, "LINESTRING"))
  points <- suppressWarnings(sf::st_collection_extract(result$roads, "POINT"))
  line_cells <- if (nrow(lines)) terra::extract(cost, terra::vect(lines), cells = TRUE, touches = FALSE)$cell else integer()
  point_cells <- if (nrow(points)) terra::extract(cost, terra::vect(points), cells = TRUE)$cell else integer()
  sort(unique(as.integer(c(line_cells, point_cells)))) - 1L
}

project <- function(method, landings = clus$landings) {
  roads::projectRoads(
    landings = landings, weightRaster = cost, roads = clus$roads,
    roadMethod = method, neighbourhood = "queen", weightFunction = roads::simpleCostFn,
    roadsInWeight = TRUE, ordering = "closest", roadsConnected = FALSE,
    roadsOut = "sf", plotRoads = FALSE
  )
}

networks <- lapply(cases$methods, function(method) {
  result <- project(method)
  list(method = method, roadCells = I(road_cells(result)),
       rasterRoadCells = I(which(terra::values(result$weightRaster, mat = FALSE) == 0) - 1L))
})

# Informational comparisons explore staged reuse without declaring every vector/cell tie identical.
# Exceptions and mismatches remain visible in the output report; they do not weaken the three fixture gates.
diagnostic <- function(fn) tryCatch(fn(), error = function(error) list(error = conditionMessage(error)))
diagnostics <- list(
  ilcp = diagnostic(function() list(roadCells = I(road_cells(project("ilcp"))))),
  staged_ilcp = diagnostic(function() {
    first <- project("ilcp", clus$landings[1:2, ])
    second <- roads::projectRoads(sim = first, landings = clus$landings[3:4, ],
                                 ordering = "closest", roadsOut = "sf", plotRoads = FALSE)
    list(stageLandingIndexes = list(I(c(0L, 1L)), I(c(2L, 3L))),
         stages = list(list(roadCells = I(road_cells(first))), list(roadCells = I(road_cells(second)))))
  })
)

result <- list(
  schema = "pgmaps-roads-native-r-reference-v1",
  producer = "native-R-roads-package",
  upstream = list(repository = cases$repository, version = as.character(utils::packageVersion("roads")), commit = remote_sha),
  generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  session = list(R = R.version.string, platform = R.version$platform,
                 packages = stats::setNames(lapply(required, function(package) as.character(utils::packageVersion(package))), required),
                 spatialLibraries = as.list(sf::sf_extSoftVersion())),
  fixture = list(name = "CLUSexample", grid = list(
    origin = I(as.numeric(terra::xyFromCell(cost, 1L))), cellM = as.numeric(terra::res(cost)[1]),
    width = terra::ncol(cost), height = terra::nrow(cost), values = I(as.numeric(terra::values(cost, mat = FALSE)))),
    roadCells = I(which(terra::values(clus$roads, mat = FALSE) > 0) - 1L),
    landingCells = I(as.integer(terra::cellFromXY(cost, sf::st_coordinates(clus$landings))) - 1L)),
  formulas = formulas, networks = networks, diagnostics = diagnostics
)
jsonlite::write_json(result, output_path, auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null", na = "null")
capture.output(utils::sessionInfo(), file = file.path(dirname(output_path), "r-session.txt"))
cat("Executed ", length(formulas), " scalar cases and ", length(networks),
    " CLUS network methods using roads@", remote_sha, ".\n", sep = "")
cat("Native reference: ", output_path, "\n", sep = "")
