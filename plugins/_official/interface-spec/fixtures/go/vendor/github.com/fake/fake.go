package fake

// Vendored code must be excluded by the scanner. This fake route must not
// appear in the spec.

type vendoredRouter struct{}

func (v vendoredRouter) GET(path string, handler func()) {}

func Register() {
	r := vendoredRouter{}
	r.GET("/vendored-should-not-appear", func() {})
}
