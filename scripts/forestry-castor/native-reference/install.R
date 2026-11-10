#!/usr/bin/env Rscript
# Pin the scheduler stack rather than silently changing the reference model.
options(repos = c(CRAN = "https://cloud.r-project.org"))
required <- c("remotes", "RSQLite", "data.table", "terra", "raster", "dplyr", "jsonlite", "digest")
missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing)
# Install in dependency order. CRAN Archive preserves the original releases.
versions <- c(RSQLite = "2.3.9", data.table = "1.17.0", terra = "1.8-29",
  raster = "3.6-31", dplyr = "1.1.4", jsonlite = "1.9.1", digest = "0.6.37",
  RcppParallel = "5.1.11-1", stringfish = "0.16.0", qs = "0.27.3",
  fpCompare = "0.2.6", Require = "0.3.1", reproducible = "2.1.2",
  quickPlot = "1.0.2", SpaDES.core = "2.1.8")
for (package in names(versions)) {
  version <- versions[[package]]
  if (!requireNamespace(package, quietly = TRUE) || packageVersion(package) != package_version(version)) {
    remotes::install_version(package, version = version, dependencies = NA,
      upgrade = "never", build_vignettes = FALSE)
  }
  stopifnot(packageVersion(package) == package_version(version))
}
