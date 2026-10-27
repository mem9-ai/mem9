package handler

import (
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

// goWithAuth keeps the request's durable reader barrier until detached writes,
// accounting and webhook enqueueing have completed.
func goWithAuth(auth *domain.AuthInfo, work func()) {
	release := func() {}
	if auth != nil && auth.Hold != nil {
		release = auth.Hold()
	}
	go func() { defer release(); work() }()
}

func goWithRuntimeUsage(lease *runtimeusage.OperationLease, work func()) {
	var auth domain.AuthInfo
	if lease != nil && lease.Subject.Hold != nil {
		auth.Hold = lease.Subject.Hold.Retain
	}
	goWithAuth(&auth, work)
}
