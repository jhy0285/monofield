package main

import "testing"

// _test.go files must be excluded by the scanner.

func TestNothing(t *testing.T) {
	r := testRouter{}
	r.GET("/test-should-not-appear", nil)
}

type testRouter struct{}

func (t testRouter) GET(path string, handler interface{}) {}
