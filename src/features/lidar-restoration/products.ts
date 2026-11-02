import { PRODUCTS, type Product } from './model'
import { PEM_PRODUCTS, type PemProduct } from './pemStructure'

export const ALL_PRODUCTS = { ...PRODUCTS, ...PEM_PRODUCTS }
export type AnalysisProduct = Product | PemProduct
