# Runs ccissr's edatopicOverlap (eda_overlap.R, Apache-2.0, pinned commit
# a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce) on generated cases and writes the
# NoPhase (onlyRegular = TRUE) overlap that drives CCISS species votes.
# Usage: Rscript run-reference.R cases.json reference.json
suppressMessages({
  library(data.table)
  library(jsonlite)
})
args <- commandArgs(trailingOnly = TRUE)
here <- dirname(normalizePath(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))))
source(file.path(here, "eda_overlap.R"))

input <- fromJSON(args[[1]], simplifyVector = FALSE)
out <- lapply(input$cases, function(case) {
  rows <- function(x, phase) {
    if (!length(x)) {
      return(data.table(BGC = character(), SS_NoSpace = character(), Edatopic = character(),
                        SpecialCode = character(), MainUnit = character())[, if (phase) .SD else .SD[, !"MainUnit"]])
    }
    dt <- rbindlist(lapply(x, function(r) {
      r$SpecialCode <- if (is.null(r$SpecialCode)) NA_character_ else r$SpecialCode
      as.data.table(r)
    }), fill = TRUE)
    dt[, SpecialCode := as.character(SpecialCode)]
    dt
  }
  E1 <- rows(case$E1, FALSE)
  E1_Phase <- rows(case$E1_Phase, TRUE)
  members <- unlist(case$members)
  props <- table(members) / length(members)
  BGC <- data.table(SiteRef = 1L, FuturePeriod = 2041L, BGC = case$currentBgc,
                    BGC.pred = names(props), BGC.prop = as.numeric(props))
  result <- tryCatch(
    edatopicOverlap(BGC, E1, E1_Phase, onlyRegular = TRUE),
    error = function(e) e
  )
  if (inherits(result, "error")) {
    return(list(id = case$id, error = conditionMessage(result)))
  }
  setorder(result, SS_NoSpace, BGC.pred, SS.pred)
  list(
    id = case$id,
    overlap = lapply(seq_len(nrow(result)), function(i) list(
      series = result$SS_NoSpace[[i]],
      predictedBgc = result$BGC.pred[[i]],
      predictedSeries = result$SS.pred[[i]],
      probability = result$SSprob[[i]]
    ))
  )
})
write(toJSON(list(
  schema = "cciss-eda-reference-v1",
  source = "bcgov/ccissr R/eda_overlap.R edatopicOverlap(onlyRegular = TRUE)",
  commit = "a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce",
  R = R.version.string,
  data.table = as.character(packageVersion("data.table")),
  cases = out
), auto_unbox = TRUE, digits = NA, pretty = FALSE), args[[2]])
