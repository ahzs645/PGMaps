# SPDX-License-Identifier: Apache-2.0
# Executes the pinned, unmodified upstream daily kernel, not a translated R reimplementation.
# Usage: Rscript generate-reference.R REFERENCE_DIRECTORY CASES_DIRECTORY OUTPUT_DIRECTORY
args <- commandArgs(trailingOnly = TRUE)
reference_dir <- if (length(args) >= 1) args[[1]] else "scripts/forest-drought/reference"
cases_dir <- if (length(args) >= 2) args[[2]] else file.path(reference_dir, "cases")
output_dir <- if (length(args) >= 3) args[[3]] else file.path(reference_dir, "generated")
if (!requireNamespace("dplyr", quietly = TRUE) || !requireNamespace("tidyr", quietly = TRUE)) {
  stop("Install dplyr and tidyr before running the unchanged upstream kernel.")
}
suppressPackageStartupMessages(library(dplyr))
suppressPackageStartupMessages(library(tidyr))
source(file.path(reference_dir, "upstream", "R", "asmrCalc.R"), local = TRUE)
load(file.path(reference_dir, "upstream", "data", "soilsData.rda"))
load(file.path(reference_dir, "upstream", "data", "asmrClass.rda"))
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
options(digits = 17)
for (case in c("seasonal", "frozen", "dry", "wet", "lateral")) {
  climate <- read.csv(file.path(cases_dir, paste0(case, ".csv")), stringsAsFactors = FALSE)
  climate$date <- as.Date(climate$date)
  climate$year <- as.integer(format(climate$date, "%Y"))
  climate$month <- as.integer(format(climate$date, "%m"))
  climate$day <- as.integer(format(climate$date, "%d"))
  soils <- soilsData
  if (case == "lateral") soils$infRate[3] <- -10
  for (latitude in c(50, 55, 60)) {
    result <- asmrCalc(climateData = climate, latitude = latitude, soils = soils)
    keep <- c("date", "year", "month", "day", "tav", "Rn", "PET", "snow", "snowbank", "pPET", paste0("S", 1:5, ".ASMR"))
    write.table(result[, keep], file = file.path(output_dir, paste0(case, "-", latitude, ".csv")), sep = ",", row.names = FALSE, col.names = TRUE, quote = FALSE, na = "NA")
    cat(sprintf("Reference %s at %d degrees: %d daily rows\n", case, latitude, nrow(result)))
  }
}
# Persist the actual loaded tables, so the port's numeric parameters can be checked too.
write.table(soilsData, file.path(output_dir, "soils.csv"), sep = ",", row.names = FALSE, quote = FALSE)
write.table(asmrClass, file.path(output_dir, "classes.csv"), sep = ",", row.names = FALSE, quote = FALSE)
writeLines(capture.output(sessionInfo()), file.path(output_dir, "R-session.txt"))
