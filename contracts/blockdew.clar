(define-data-var paused bool false)
(define-data-var fee-rate uint u0)

(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_PAUSED (err u101))

(define-read-only (get-fee)
  (ok (var-get fee-rate))
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-public (set-fee (rate uint))
  (begin
    (asserts! (is-eq tx-sender (contract-owner)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (var-set fee-rate rate)
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (contract-owner)) ERR_UNAUTHORIZED)
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (contract-owner)) ERR_UNAUTHORIZED)
    (var-set paused false)
    (ok true)
  )
)
